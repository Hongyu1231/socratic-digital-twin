"""Append a bounded expert-interview DOCX to a private teaching pack.

The DOCX is treated as source data.  This command never follows external
relationships, makes network calls, executes embedded content, or changes the
input pack.  It copies only the already-registered media into a new private
revision and appends one source-typed article containing provenance-rich
DOCX chunks.

Example::

    python scripts/import-expert-interview.py \
      --document "PATH/Impacted maxillary canines - interviews with the expert panel.docx" \
      --pack-dir work/teaching-materials \
      --output work/teaching-materials-expert-panel

The script deliberately does not publish or upload the resulting directory.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import unicodedata
import uuid
import zipfile
from typing import Any, Iterable

from docx import Document


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from draft_clinical_content import build_clinical_review


REPO_ROOT = Path(__file__).resolve().parents[1]
NAMESPACE = uuid.UUID("78fd4b4d-f2e6-4a72-a1bc-df67f34d6cf8")
MAX_DOCX_BYTES = 25 * 1024 * 1024
MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_DOCX_MEMBER_BYTES = 50 * 1024 * 1024
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_MEDIA_BYTES = 20 * 1024 * 1024
MAX_CHUNK_CHARS = 1_800
SHA256_RE = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
CASE_TITLE_RE = re.compile(r"^Case\s+(\d+)\s*-\s*.+$", re.IGNORECASE)
COMMENTS_RE = re.compile(r"^Comments\s+on\s+Case\s+(\d+)$", re.IGNORECASE)
EXPERT_RE = re.compile(r"^Expert\s+(\d+)$", re.IGNORECASE)
SPEAKER_RE = re.compile(r"^([A-Za-z][A-Za-z ]{1,48})\s*:\s*(.+)$")
EXTERNAL_RELATION_RE = re.compile(r"TargetMode\s*=\s*['\"]External['\"]", re.IGNORECASE)


def normalize_text(value: str) -> str:
    """Normalize DOCX text without removing words or punctuation."""

    return " ".join(unicodedata.normalize("NFKC", value).replace("\xa0", " ").split())


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_source_id(source_hash: str) -> str:
    """Return a deterministic UUID for one source document."""

    return str(uuid.uuid5(NAMESPACE, f"expert-interview:{source_hash}"))


def revision_package_id(original_package_id: str, source_hash: str) -> str:
    """Hash the original package id and source hash without changing case/media ids."""

    return sha256((original_package_id + source_hash).encode("ascii"))


def _absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _normcase(path: Path) -> str:
    return os.path.normcase(os.fspath(_absolute(path)))


def is_same_or_child(parent: Path, child: Path) -> bool:
    """Case-insensitive containment suitable for Windows paths."""

    parent_text = _normcase(parent)
    child_text = _normcase(child)
    try:
        return os.path.commonpath([parent_text, child_text]) == parent_text
    except ValueError:
        return False


def _symlink_component(path: Path) -> Path | None:
    """Find a symlink in an existing path prefix, including the leaf."""

    absolute = _absolute(path)
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if os.path.lexists(os.fspath(current)) and current.is_symlink():
            return current
    return None


def _reject_public_or_repo_root(path: Path, label: str) -> None:
    absolute = _absolute(path)
    public_dir = REPO_ROOT / "public"
    if _normcase(absolute) == _normcase(REPO_ROOT):
        raise ValueError(f"{label} cannot be the repository root")
    if is_same_or_child(public_dir, absolute):
        raise ValueError(f"{label} cannot be inside public/")


def _safe_private_path(path: Path, label: str, *, must_exist: bool) -> Path:
    absolute = _absolute(path)
    _reject_public_or_repo_root(absolute, label)
    if _symlink_component(absolute) is not None:
        raise ValueError(f"{label} contains an unsafe symlink")
    if must_exist and not absolute.exists():
        raise ValueError(f"{label} does not exist")
    return absolute


def _read_regular_file(path: Path, label: str, max_bytes: int) -> bytes:
    if _symlink_component(path) is not None or not path.is_file():
        raise ValueError(f"{label} must be a regular file")
    size = path.stat().st_size
    if size > max_bytes:
        raise ValueError(f"{label} exceeds its size limit")
    return path.read_bytes()


def _safe_relative(value: Any, label: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError(f"{label} is unsafe")
    if "\\" in value or ":" in value:
        raise ValueError(f"{label} is unsafe")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise ValueError(f"{label} is unsafe")
    return candidate


def _registered_file(root: Path, relative: PurePosixPath, label: str) -> Path:
    candidate = root.joinpath(*relative.parts)
    if not is_same_or_child(root, candidate) or _symlink_component(candidate) is not None:
        raise ValueError(f"{label} escapes the pack directory")
    if not candidate.is_file():
        raise ValueError(f"{label} is missing")
    return candidate


def _is_webp(data: bytes) -> bool:
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def validate_docx_container(data: bytes) -> int:
    """Validate the OOXML container and count, but never follow, external rels."""

    if len(data) == 0 or len(data) > MAX_DOCX_BYTES:
        raise ValueError("DOCX exceeds its size limit")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise ValueError("Document is not a valid DOCX container") from exc

    names: set[str] = set()
    uncompressed = 0
    external_links = 0
    has_document = False
    has_content_types = False
    try:
        for info in archive.infolist():
            name = info.filename
            normalized_name = name.casefold()
            if normalized_name in names:
                raise ValueError("DOCX contains duplicate archive entries")
            names.add(normalized_name)
            _safe_relative(name, "DOCX archive path")

            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                raise ValueError("DOCX contains a symlink entry")
            if info.file_size > MAX_DOCX_MEMBER_BYTES:
                raise ValueError("DOCX archive member exceeds its size limit")
            uncompressed += info.file_size
            if uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES:
                raise ValueError("DOCX exceeds its uncompressed size limit")

            if normalized_name == "word/document.xml":
                has_document = True
            if normalized_name == "[content_types].xml":
                has_content_types = True
            if normalized_name.endswith(".rels"):
                # Relationship targets are deliberately not dereferenced.
                rels = archive.read(info)
                external_links += len(EXTERNAL_RELATION_RE.findall(rels.decode("utf-8", errors="ignore")))
    finally:
        archive.close()

    if not has_document or not has_content_types:
        raise ValueError("DOCX is missing its required OOXML parts")
    return external_links


def _load_json(path: Path, label: str) -> dict[str, Any]:
    data = _read_regular_file(path, label, MAX_MANIFEST_BYTES)
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain an object")
    return value


def _require_sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValueError(f"{label} must be a SHA-256 hash")
    return value.lower()


def _require_uuid(value: Any, label: str) -> str:
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        raise ValueError(f"{label} must be a UUID")
    return value.lower()


def load_pack(pack_dir: Path) -> dict[str, Any]:
    """Load and verify the original private pack and registered media files."""

    root = _safe_private_path(pack_dir, "Pack directory", must_exist=True)
    if not root.is_dir():
        raise ValueError("Pack directory must be a directory")
    manifest = _load_json(root / "manifest.json", "Pack manifest")
    if manifest.get("formatVersion") != 1:
        raise ValueError("Pack manifest format is unsupported")
    package_id = _require_sha(manifest.get("packageId"), "Pack packageId")

    cases = manifest.get("cases")
    articles = manifest.get("articles")
    media = manifest.get("media")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Pack manifest has no cases")
    if not isinstance(articles, list) or not isinstance(media, list):
        raise ValueError("Pack manifest arrays are invalid")

    case_ids: set[str] = set()
    case_by_number: dict[int, str] = {}
    for index, entry in enumerate(cases, 1):
        if not isinstance(entry, dict) or not isinstance(entry.get("case"), dict):
            raise ValueError(f"Pack case {index} is invalid")
        clinical_case = entry["case"]
        case_id = _require_uuid(clinical_case.get("id"), f"Pack case {index} id")
        if case_id in case_ids:
            raise ValueError(f"Pack contains duplicate case {case_id}")
        case_ids.add(case_id)
        title = clinical_case.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"Pack case {index} title is invalid")
        title_match = CASE_TITLE_RE.fullmatch(normalize_text(title))
        if title_match:
            number = int(title_match.group(1))
            if number in case_by_number:
                raise ValueError(f"Pack has multiple unique matches for Case {number}")
            case_by_number[number] = case_id

    article_ids: set[str] = set()
    for index, article in enumerate(articles, 1):
        if not isinstance(article, dict):
            raise ValueError(f"Pack article {index} is invalid")
        article_id = article.get("id")
        if not isinstance(article_id, str) or not article_id.strip() or article_id in article_ids:
            raise ValueError(f"Pack article {index} id is invalid")
        article_ids.add(article_id)
        if not isinstance(article.get("title"), str) or not article["title"].strip():
            raise ValueError(f"Pack article {index} title is invalid")
        filename = _safe_relative(article.get("filename"), f"Pack article {index} filename")
        _require_sha(article.get("sha256"), f"Pack article {index} hash")
        pages = article.get("pages")
        if not isinstance(pages, list) or len(pages) > 20_000:
            raise ValueError(f"Pack article {index} pages are invalid")
        for page in pages:
            if not isinstance(page, dict) or not isinstance(page.get("page"), int) or page["page"] <= 0:
                raise ValueError(f"Pack article {index} page is invalid")
            if not isinstance(page.get("text"), str) or not page["text"].strip():
                raise ValueError(f"Pack article {index} page text is invalid")

    media_by_id: dict[str, Path] = {}
    attachment_ids: set[str] = set()
    for index, item in enumerate(media, 1):
        if not isinstance(item, dict):
            raise ValueError(f"Pack media {index} is invalid")
        media_id = _require_uuid(item.get("id"), f"Pack media {index} id")
        case_id = _require_uuid(item.get("caseId"), f"Pack media {index} caseId")
        if case_id not in case_ids or media_id in media_by_id:
            raise ValueError(f"Pack media {index} is not uniquely registered")
        relative = _safe_relative(item.get("file"), f"Pack media {index} file")
        if relative.as_posix().casefold() != f"media/{media_id}.webp":
            raise ValueError(f"Pack media {media_id} has an unexpected path")
        media_file = _registered_file(root, relative, f"Pack media {media_id}")
        media_bytes = _read_regular_file(media_file, f"Pack media {media_id}", MAX_MEDIA_BYTES)
        if not _is_webp(media_bytes):
            raise ValueError(f"Pack media {media_id} is not WebP")
        if _require_sha(item.get("sha256"), f"Pack media {media_id} hash") != sha256(media_bytes):
            raise ValueError(f"Pack media {media_id} failed its hash check")
        media_by_id[media_id] = media_file

    for entry in cases:
        clinical_case = entry["case"]
        attachments = clinical_case.get("attachments", [])
        if not isinstance(attachments, list):
            raise ValueError("Pack case attachments are invalid")
        for attachment in attachments:
            if not isinstance(attachment, dict):
                raise ValueError("Pack attachment is invalid")
            attachment_id = _require_uuid(attachment.get("id"), "Pack attachment id")
            if attachment_id in attachment_ids or attachment_id not in media_by_id:
                raise ValueError("Pack attachment is not registered exactly once")
            attachment_ids.add(attachment_id)
            if _require_uuid(media_by_id[attachment_id].name.split(".")[0], "Pack media filename") != attachment_id:
                raise ValueError("Pack attachment media mapping is invalid")
    if attachment_ids != set(media_by_id):
        raise ValueError("Pack contains unregistered media")

    return {
        "root": root,
        "manifest": manifest,
        "caseByNumber": case_by_number,
        "mediaFiles": media_by_id,
    }


def _heading_level(paragraph: Any) -> int | None:
    style = getattr(paragraph, "style", None)
    name = normalize_text(getattr(style, "name", "")) if style is not None else ""
    match = re.fullmatch(r"Heading\s*([23])", name, re.IGNORECASE)
    return int(match.group(1)) if match else None


def _section_case_ids(heading: str, case_by_number: dict[int, str]) -> list[str] | None:
    match = COMMENTS_RE.fullmatch(heading)
    if not match:
        return None
    number = int(match.group(1))
    case_id = case_by_number.get(number)
    if case_id is None:
        raise ValueError(f"{heading} does not uniquely map to a case in the pack")
    return [case_id]


def _is_question(text: str) -> bool:
    match = SPEAKER_RE.match(text)
    if not match:
        return False
    speaker = normalize_text(match.group(1)).casefold()
    body = match.group(2).strip()
    # Interviewer prompts are question boundaries even when a source line
    # accidentally omits its final question mark.  The first Case 3 prompt is
    # labelled Oral surgeon, so speaker plus punctuation is also supported.
    return speaker == "interviewer" or (speaker in {"oral surgeon", "clinician"} and "?" in body)


def _split_at_seams(text: str, limit: int) -> list[str]:
    """Split text at sentence/word seams, preserving every non-whitespace token."""

    if limit < 1:
        raise ValueError("Chunk limit is too small")
    remaining = text.strip()
    parts: list[str] = []
    while len(remaining) > limit:
        window = remaining[: limit + 1]
        sentence_matches = [
            match
            for match in re.finditer(r"[.!?](?:[\"')\]]+)?(?=\s|$)", window)
            if match.end() <= limit
        ]
        cut = sentence_matches[-1].end() if sentence_matches else -1
        if cut <= 0:
            whitespace = [match.start() for match in re.finditer(r"\s+", window[:limit])]
            cut = whitespace[-1] if whitespace else limit
        piece = remaining[:cut].strip()
        if not piece:
            cut = limit
            piece = remaining[:cut].strip()
        parts.append(piece)
        remaining = remaining[cut:].strip()
    if remaining:
        parts.append(remaining)
    return parts


def _chunk_unit(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep Q&A paragraphs together where possible, repeating the question on continuations."""

    question = records[0]["text"] if records and _is_question(records[0]["text"]) else ""
    chunks: list[dict[str, Any]] = []
    current_text = ""
    current_records: list[dict[str, Any]] = []
    first_chunk = True

    def flush() -> None:
        nonlocal current_text, current_records
        if current_text:
            chunks.append({"text": current_text, "records": current_records})
            current_text = ""
            current_records = []

    for record in records:
        for piece in _split_at_seams(record["text"], MAX_CHUNK_CHARS):
            if not current_text:
                prefix = "" if first_chunk or not question or len(question) >= MAX_CHUNK_CHARS else question + "\n\n"
                available = MAX_CHUNK_CHARS - len(prefix)
                piece_parts = _split_at_seams(piece, available) if len(piece) > available else [piece]
                current_text = prefix + piece_parts[0]
                current_records = [record]
                first_chunk = False
                for remainder in piece_parts[1:]:
                    flush()
                    prefix = question + "\n\n" if question and len(question) < MAX_CHUNK_CHARS else ""
                    available = MAX_CHUNK_CHARS - len(prefix)
                    remainder_parts = _split_at_seams(remainder, available) if len(remainder) > available else [remainder]
                    current_text = prefix + remainder_parts[0]
                    current_records = [record]
                    for final_remainder in remainder_parts[1:]:
                        flush()
                        current_text = prefix + final_remainder
                        current_records = [record]
            elif len(current_text) + 2 + len(piece) <= MAX_CHUNK_CHARS:
                current_text += "\n\n" + piece
                current_records.append(record)
            else:
                flush()
                prefix = question + "\n\n" if question and len(question) < MAX_CHUNK_CHARS else ""
                available = MAX_CHUNK_CHARS - len(prefix)
                piece_parts = _split_at_seams(piece, available) if len(piece) > available else [piece]
                current_text = prefix + piece_parts[0]
                current_records = [record]
                for remainder in piece_parts[1:]:
                    flush()
                    current_text = prefix + remainder
                    current_records = [record]
    flush()
    return chunks


def _make_locator(records: Iterable[dict[str, Any]], section: str, expert: str) -> str:
    indexes = [record["index"] for record in records]
    start = min(indexes)
    end = max(indexes)
    return f'DOCX paragraphs {start}-{end}; section "{section}"; {expert}'


def parse_interview(data: bytes, filename: str, case_by_number: dict[int, str]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Parse one interview into a source-typed article and an import report."""

    external_links = validate_docx_container(data)
    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:  # python-docx raises several parser-specific errors
        raise ValueError("DOCX document body is invalid") from exc
    if document.tables:
        raise ValueError("Interview DOCX tables are not supported; export their text as paragraphs")

    records = []
    for index, paragraph in enumerate(document.paragraphs, 1):
        text = normalize_text(paragraph.text)
        if not text:
            continue
        records.append({"index": index, "text": text, "level": _heading_level(paragraph)})
    if not records:
        raise ValueError("Interview DOCX contains no nonblank paragraphs")

    sections: list[dict[str, Any]] = []
    current_section: dict[str, Any] | None = None
    current_expert: dict[str, Any] | None = None
    for record in records:
        level = record["level"]
        if level == 2:
            if current_expert is not None:
                sections[-1]["experts"].append(current_expert)
                current_expert = None
            heading = record["text"]
            current_section = {
                "heading": heading,
                "record": record,
                "caseIds": _section_case_ids(heading, case_by_number),
                "experts": [],
            }
            sections.append(current_section)
            continue
        if level == 3:
            if current_section is None:
                raise ValueError("Expert heading appears before a section heading")
            if current_expert is not None:
                current_section["experts"].append(current_expert)
            expert_match = EXPERT_RE.fullmatch(record["text"])
            if not expert_match:
                raise ValueError(f"Unsupported expert heading: {record['text']}")
            current_expert = {"label": f"Expert {int(expert_match.group(1))}", "record": record, "records": []}
            continue
        if current_section is None or current_expert is None:
            raise ValueError("Interview text appears outside a section and expert heading")
        current_expert["records"].append(record)
    if current_section is None or current_expert is None:
        raise ValueError("Interview DOCX must contain section and expert headings")
    current_section["experts"].append(current_expert)

    pages: list[dict[str, Any]] = []
    body_paragraph_indexes: set[int] = set()
    heading_indexes: set[int] = set()
    for section in sections:
        heading_indexes.add(section["record"]["index"])
        for expert in section["experts"]:
            heading_indexes.add(expert["record"]["index"])
            body_paragraph_indexes.update(record["index"] for record in expert["records"])

            units: list[list[dict[str, Any]]] = []
            unit: list[dict[str, Any]] = []
            for record in expert["records"]:
                if unit and _is_question(record["text"]):
                    units.append(unit)
                    unit = []
                unit.append(record)
            if unit:
                units.append(unit)

            block_chunks: list[dict[str, Any]] = []
            for unit_records in units:
                block_chunks.extend(_chunk_unit(unit_records))
            header = f"{section['heading']}\n{expert['label']}"
            if not block_chunks:
                block_chunks = [{"text": header, "records": []}]
            else:
                first = block_chunks[0]
                prefixed = header + "\n\n" + first["text"]
                if len(prefixed) <= MAX_CHUNK_CHARS:
                    first["text"] = prefixed
                    first["records"] = [section["record"], expert["record"]] + first["records"]
                else:
                    available = MAX_CHUNK_CHARS - len(header) - 2
                    prefix_parts = _split_at_seams(first["text"], available)
                    first["text"] = header + "\n\n" + prefix_parts[0]
                    first["records"] = [section["record"], expert["record"]] + first["records"]
                    for remainder in reversed(prefix_parts[1:]):
                        block_chunks.insert(1, {"text": remainder, "records": first["records"][2:]})

            for block_chunk in block_chunks:
                locator = _make_locator(
                    block_chunk["records"] or [section["record"], expert["record"]],
                    section["heading"],
                    expert["label"],
                )
                page = {
                    "page": len(pages) + 1,
                    "text": block_chunk["text"],
                    "locator": locator,
                    "expert": expert["label"],
                    "section": section["heading"],
                }
                if section["caseIds"] is not None:
                    page["caseIds"] = list(section["caseIds"])
                pages.append(page)

    expected_indexes = heading_indexes | body_paragraph_indexes
    actual_indexes: set[int] = set()
    for page in pages:
        match = re.search(r"DOCX paragraphs (\d+)-(\d+);", page["locator"])
        if match:
            actual_indexes.update(range(int(match.group(1)), int(match.group(2)) + 1))
    # Blank paragraphs are intentionally omitted. Every nonblank source
    # paragraph must be represented in at least one provenance range.
    if not expected_indexes.issubset(actual_indexes):
        missing = sorted(expected_indexes - actual_indexes)
        raise ValueError(f"Interview paragraphs were not represented: {missing[:8]}")

    source_hash = sha256(data)
    article = {
        "id": stable_source_id(source_hash),
        "title": Path(filename).stem,
        "filename": Path(filename).name,
        "sha256": source_hash,
        "sourceHash": source_hash,
        "sourceType": "expert_interview",
        "pages": pages,
    }
    report = {
        "sourceHash": source_hash,
        "sourceId": article["id"],
        "sourceType": article["sourceType"],
        "filename": article["filename"],
        "sections": len(sections),
        "experts": sum(len(section["experts"]) for section in sections),
        "chunks": len(pages),
        "nonblankParagraphs": len(records),
        "externalLinksIgnored": external_links,
    }
    return article, report


def _source_hash_for_article(article: dict[str, Any]) -> str | None:
    source_hash = article.get("sourceHash")
    if isinstance(source_hash, str) and SHA256_RE.fullmatch(source_hash):
        return source_hash.lower()
    if article.get("sourceType") == "expert_interview":
        candidate = article.get("sha256")
        if isinstance(candidate, str) and SHA256_RE.fullmatch(candidate):
            return candidate.lower()
    return None


def _validate_output_matches(output: Path, target_manifest: dict[str, Any], pack: dict[str, Any]) -> bool:
    if not output.is_dir():
        raise ValueError("Output exists but is not a directory")
    existing = load_pack(output)
    if existing["manifest"] != target_manifest:
        raise ValueError("Output exists with a different pack; refusing to overwrite it")
    for media_id, source_file in pack["mediaFiles"].items():
        output_file = _registered_file(output, PurePosixPath("media") / f"{media_id}.webp", f"Output media {media_id}")
        if sha256(output_file.read_bytes()) != sha256(source_file.read_bytes()):
            raise ValueError("Output media differs from the original registered file")
    return True


def build(document: Path, pack_dir: Path, output: Path) -> dict[str, Any]:
    """Create one private revision, or return a no-op report for an identical one."""

    document_path = _safe_private_path(document, "Interview document", must_exist=True)
    if document_path.suffix.casefold() != ".docx":
        raise ValueError("Interview document must have a .docx extension")
    document_bytes = _read_regular_file(document_path, "Interview document", MAX_DOCX_BYTES)
    pack = load_pack(pack_dir)
    article, report = parse_interview(document_bytes, document_path.name, pack["caseByNumber"])

    base_manifest = pack["manifest"]
    source_hash = article["sourceHash"]
    existing = [
        candidate
        for candidate in base_manifest["articles"]
        if _source_hash_for_article(candidate) == source_hash
    ]
    if len(existing) > 1:
        raise ValueError("Pack contains duplicate expert-interview source hashes")
    target_manifest = copy.deepcopy(base_manifest)
    expected_package_id = revision_package_id(base_manifest["packageId"], source_hash)
    if existing:
        if existing[0] != article:
            raise ValueError("Existing expert-interview source hash has different metadata")
        # A pack that already has this exact source is already complete. Keep
        # its package id so rerunning against an augmented pack never creates a
        # second hash revision (or silently changes an existing pack).
        target_manifest["packageId"] = base_manifest["packageId"]
    else:
        target_manifest["packageId"] = expected_package_id
        target_manifest["articles"].append(article)

    # Adding or re-importing expert material creates a new reviewable content
    # revision.  Keep the approval marker in the raw manifest and invalidate
    # any previous approval because the source-backed case payload may have
    # changed since that approval was recorded.
    target_manifest["clinicalReview"] = build_clinical_review(target_manifest["cases"])

    output_path = _absolute(output)
    _reject_public_or_repo_root(output_path, "Output directory")
    if _symlink_component(output_path) is not None:
        raise ValueError("Output directory contains an unsafe symlink")
    if _normcase(output_path) == _normcase(pack["root"]):
        raise ValueError("Output directory must be different from the input pack")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if os.path.lexists(os.fspath(output_path)):
        _validate_output_matches(output_path, target_manifest, pack)
        report.update({
            "packageId": target_manifest["packageId"],
            "basePackageId": base_manifest["packageId"],
            "output": str(output_path),
            "noop": True,
        })
        return report

    staging: Path | None = None
    try:
        staging = Path(tempfile.mkdtemp(prefix=f".{output_path.name}.staging-", dir=output_path.parent))
        media_dir = staging / "media"
        media_dir.mkdir()
        for media_id, source_file in pack["mediaFiles"].items():
            destination = media_dir / f"{media_id}.webp"
            shutil.copyfile(source_file, destination)
            if sha256(destination.read_bytes()) != sha256(source_file.read_bytes()):
                raise ValueError(f"Copied media {media_id} failed its hash check")

        manifest_bytes = json.dumps(target_manifest, ensure_ascii=False, indent=2).encode("utf-8")
        (staging / "manifest.tmp").write_bytes(manifest_bytes)
        (staging / "manifest.tmp").replace(staging / "manifest.json")
        report.update({
            "packageId": target_manifest["packageId"],
            "basePackageId": base_manifest["packageId"],
            "output": str(output_path),
            "noop": False,
        })
        (staging / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

        # Recheck immediately before the final rename. os.rename is
        # non-overwriting on Windows; the explicit check also protects a race
        # on platforms where directory rename semantics differ.
        if os.path.lexists(os.fspath(output_path)):
            raise ValueError("Output appeared during import; refusing to overwrite it")
        os.rename(os.fspath(staging), os.fspath(output_path))
        staging = None
    finally:
        if staging is not None and staging.exists():
            shutil.rmtree(staging)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document", type=Path, required=True)
    parser.add_argument("--pack-dir", type=Path, default=Path("work/teaching-materials"))
    parser.add_argument("--output", type=Path, default=Path("work/teaching-materials-expert-panel"))
    args = parser.parse_args()
    result = build(args.document, args.pack_dir, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
