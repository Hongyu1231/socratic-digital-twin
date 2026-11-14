"""Golden tests: the canine import and Case 1 review outputs must stay byte-identical.

The expected hashes were recorded from master before the second-molar content
loader was added. Every fixture is synthetic and built deterministically, so a
changed hash means the canine path itself changed.
"""

from __future__ import annotations

import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

from docx import Document
from PIL import Image

SCRIPTS = Path(__file__).resolve().parent


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


IMPORTER = load("golden_import_teaching_materials", "import-teaching-materials.py")
REVIEW = load("golden_prepare_clinical_review", "prepare-clinical-review.py")
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def deterministic_zip(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(members):
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, members[name])
    return buffer.getvalue()


def synthetic_docx(paragraphs: list[str]) -> bytes:
    document = Document()
    stamp = datetime.datetime(2026, 1, 1)
    document.core_properties.created = stamp
    document.core_properties.modified = stamp
    document.core_properties.last_printed = stamp
    for text in paragraphs:
        document.add_paragraph(text)
    raw = io.BytesIO()
    document.save(raw)
    with zipfile.ZipFile(io.BytesIO(raw.getvalue())) as source:
        return deterministic_zip({name: source.read(name) for name in source.namelist()})


def synthetic_png(colour: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 6), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def synthetic_pdf(text: str) -> bytes:
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def synthetic_case_members(number: int) -> dict[str, bytes]:
    folder = f"Case {number}"
    return {
        f"{folder}/Description of Case {number}.docx": synthetic_docx([
            "Information to be presented to the student:",
            f"A synthetic learner introduction for case {number}.",
            "Summary of the case (faculty reference only):",
            f"A synthetic faculty summary for case {number}.",
        ]),
        f"{folder}/{folder} Xray (OPG).png": synthetic_png((10 * number, 20, 30)),
        f"{folder}/{folder} Study Models.png": synthetic_png((40, 10 * number, 60)),
    }


def write_synthetic_zips(root: Path) -> tuple[Path, Path]:
    cases = root / "cases.zip"
    articles = root / "articles.zip"
    cases.write_bytes(deterministic_zip({**synthetic_case_members(1), **synthetic_case_members(2)}))
    articles.write_bytes(deterministic_zip({
        "1. Synthetic article.pdf": synthetic_pdf(
            "Synthetic published passage about tooth eruption and orthodontic assessment for regression tests only."),
    }))
    return cases, articles


def tree_digest(root: Path, names: list[str]) -> str:
    digest = hashlib.sha256()
    for name in names:
        digest.update(name.encode() + b"\0" + (root / name).read_bytes() + b"\0")
    for media in sorted((root / "media").glob("*.webp")):
        digest.update(media.name.encode() + b"\0" + media.read_bytes() + b"\0")
    return digest.hexdigest()


def synthetic_review_pack(root: Path) -> str:
    """Write the same single-case pack shape the canine review path consumes."""

    media_id = "11111111-1111-4111-8111-111111111111"
    media_bytes = b"synthetic-webp-bytes"
    (root / "media").mkdir()
    (root / "media" / f"{media_id}.webp").write_bytes(media_bytes)
    case_id = "22222222-2222-4222-8222-222222222222"
    attachments = [
        {"id": media_id, "kind": "image", "title": "Xray (OPG)", "description": "Synthetic record",
         "url": f"/api/materials/{media_id}"},
    ]
    manifest = {
        "formatVersion": 1,
        "packageId": "a" * 64,
        "cases": [{
            "case": {
                "id": case_id, "title": "Case 1 - Canine assessment", "description": "Synthetic description.",
                "difficulty": "advanced", "status": "draft", "version": 1, "sourceCaseId": None,
                "publishedAt": None, "learningObjectives": ["Use evidence carefully."],
                "phases": [], "attachments": attachments,
                "findings": [{"id": "case1-palatal-palpation", "title": "Old", "text": "Old text.", "unlockPhase": 1}],
                "isTestFixture": False,
            },
            "expertNotes": "Synthetic expert note.",
            "sourceDocument": "Description of Case 1.docx",
        }],
        "articles": [{"id": "article-1", "title": "Synthetic source", "filename": "source.pdf", "sha256": "b" * 64,
                      "pages": [{"page": 1, "text": "Synthetic passage.", "caseIds": [case_id]}]}],
        "media": [{"id": media_id, "caseId": case_id, "file": f"media/{media_id}.webp", "mimeType": "image/webp",
                   "sha256": hashlib.sha256(media_bytes).hexdigest(), "width": 10, "height": 10}],
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return case_id


REVIEW_FILES = ["manifest.json", "draft-review.json", "review.md"]
IMPORT_FILES = ["manifest.json", "draft-review.json"]

# Recorded from master (d259b11) before the content loader existed; review_case1_feedback
# refreshed for the 13 Nov Case 1 clinical feedback edits (8987702).
EXPECTED = {
    "import": "d2379bfa414de63dd97eca2e9173529764ad1928d2342b951648e2da54f2b29a",
    "review_generic": "e5261656ff78f0c48b7fd8cea9285902805c4c5defbb80f866b24f695b5c3936",
    "review_case1_feedback": "8297825e368996f289cbfa88eb7da88e3ed963b10c6cd1a2bdbafea51f38d08e",
}


def current_digests() -> dict[str, str]:
    result = {}
    with tempfile.TemporaryDirectory() as directory:
        base = Path(directory)
        cases, articles = write_synthetic_zips(base)
        output = base / "import"
        IMPORTER.build(cases, articles, output)
        result["import"] = tree_digest(output, IMPORT_FILES)

        source = base / "source"
        source.mkdir()
        case_id = synthetic_review_pack(source)
        REVIEW.build(source, base / "generic")
        result["review_generic"] = tree_digest(base / "generic", REVIEW_FILES)
        REVIEW.build(source, base / "case1", case_id=case_id, case1_feedback=True)
        result["review_case1_feedback"] = tree_digest(base / "case1", REVIEW_FILES)
    return result


class CanineOutputUnchangedTests(unittest.TestCase):
    def test_fixtures_are_deterministic(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            a = write_synthetic_zips(Path(first))
            b = write_synthetic_zips(Path(second))
            self.assertEqual([p.read_bytes() for p in a], [p.read_bytes() for p in b])

    def test_canine_outputs_match_the_recorded_master_bytes(self):
        self.assertEqual(current_digests(), EXPECTED)


if __name__ == "__main__":
    if "--print" in sys.argv:
        print(json.dumps(current_digests(), indent=2))
    else:
        unittest.main()
