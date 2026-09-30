"""Prepare a private, clinician-reviewable revision of an imported pack.

The command never publishes, uploads, deletes, or mutates the source pack. It
copies the registered media byte-for-byte, creates new case/phase IDs with a
new version lineage, remaps case-scoped article and media references, and
marks the resulting manifest as pending clinical review. The generated pack
contains the source-backed case descriptions and expert notes for private
review, but its structured phases remain application-authored draft content.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import uuid
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from draft_clinical_content import (  # noqa: E402
    build_clinical_review,
    build_draft_phases,
    build_draft_review,
    clinical_content_sha256,
)


NAMESPACE = uuid.UUID("3b7cb4f5-c8a1-4c3a-9bd8-04a0fb5f98e5")
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
REVISION_LABEL = "clinical-review-2026-09-30"


def canonical_json(value: Any) -> bytes:
    """Match the publisher's compact recursive-key-sorted JSON encoding."""

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_sha256(value: Any) -> str:
    return sha256_bytes(canonical_json(value))


def identity(value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, value))


def absolute_directory(path: Path, label: str) -> Path:
    candidate = path.expanduser().resolve()
    if not candidate.is_dir():
        raise ValueError(f"{label} must be an existing directory")
    return candidate


def safe_relative(value: Any, label: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value or ":" in value:
        raise ValueError(f"{label} is unsafe")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise ValueError(f"{label} is unsafe")
    return candidate


def contained_file(root: Path, relative: Any, label: str) -> Path:
    candidate_relative = safe_relative(relative, label)
    candidate = (root.joinpath(*candidate_relative.parts)).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"{label} escapes the source pack") from exc
    if not candidate.is_file():
        raise ValueError(f"{label} is missing")
    return candidate


def load_manifest(root: Path) -> dict[str, Any]:
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file() or manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Source manifest is missing or too large")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Source manifest is invalid") from exc
    if not isinstance(manifest, dict) or manifest.get("formatVersion") != 1:
        raise ValueError("Source manifest format is unsupported")
    if not isinstance(manifest.get("packageId"), str) or len(manifest["packageId"]) != 64:
        raise ValueError("Source manifest packageId is invalid")
    if not isinstance(manifest.get("cases"), list) or not manifest["cases"]:
        raise ValueError("Source manifest has no cases")
    if not isinstance(manifest.get("articles"), list) or not isinstance(manifest.get("media"), list):
        raise ValueError("Source manifest arrays are invalid")
    return manifest


def remap_local_media_url(value: Any, media_id: str) -> Any:
    if isinstance(value, str) and (value.startswith("/api/materials/") or value.startswith("media/")):
        return f"/api/materials/{media_id}"
    return value


def remap_attachment(attachment: dict[str, Any], media_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    result = copy.deepcopy(attachment)
    media_id = str(result.get("id", "")).lower()
    if media_id not in media_by_id:
        raise ValueError(f"Attachment {media_id} is not registered in source media")
    # Media IDs remain content-addressed and may safely be reused in a new
    # private pack. Their URL is rebuilt so no stale pack-local reference is
    # carried into the revision.
    result["id"] = media_id
    if "url" in result:
        result["url"] = remap_local_media_url(result["url"], media_id)
    if "sourceUrl" in result:
        result["sourceUrl"] = remap_local_media_url(result["sourceUrl"], media_id)
    return result


def copy_media(source_root: Path, output_root: Path, media: list[dict[str, Any]]) -> None:
    destination_dir = output_root / "media"
    destination_dir.mkdir(parents=True, exist_ok=False)
    for item in media:
        media_id = str(item.get("id", "")).lower()
        source_file = contained_file(source_root, item.get("file"), f"Media {media_id}")
        source_bytes = source_file.read_bytes()
        expected_hash = str(item.get("sha256", "")).lower()
        if sha256_bytes(source_bytes) != expected_hash:
            raise ValueError(f"Media {media_id} failed its source hash check")
        destination = destination_dir / f"{media_id}.webp"
        shutil.copyfile(source_file, destination)
        if sha256_bytes(destination.read_bytes()) != expected_hash:
            raise ValueError(f"Media {media_id} failed its copy hash check")


def transform_manifest(source: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    source_cases = source["cases"]
    source_package_id = source["packageId"]
    case_map: dict[str, str] = {}
    for entry in source_cases:
        if not isinstance(entry, dict) or not isinstance(entry.get("case"), dict):
            raise ValueError("Source case entry is invalid")
        old_case = entry["case"]
        old_id = str(old_case.get("id", "")).lower()
        try:
            uuid.UUID(old_id)
        except (ValueError, AttributeError) as exc:
            raise ValueError("Source case ID is invalid") from exc
        if old_id in case_map:
            raise ValueError(f"Duplicate source case {old_id}")
        case_map[old_id] = identity(f"{source_package_id}:{REVISION_LABEL}:case:{old_id}")

    media_by_id: dict[str, dict[str, Any]] = {}
    for item in source["media"]:
        if not isinstance(item, dict):
            raise ValueError("Source media entry is invalid")
        media_id = str(item.get("id", "")).lower()
        if media_id in media_by_id:
            raise ValueError(f"Duplicate source media {media_id}")
        media_by_id[media_id] = item

    cases: list[dict[str, Any]] = []
    for entry in source_cases:
        old_case = entry["case"]
        old_id = str(old_case["id"]).lower()
        new_id = case_map[old_id]
        previous_root = str(old_case.get("sourceCaseId") or old_id).lower()
        version = old_case.get("version", 1)
        if not isinstance(version, int) or version < 1:
            raise ValueError(f"Source case {old_id} has an invalid version")
        new_case = copy.deepcopy(old_case)
        new_case["id"] = new_id
        new_case["sourceCaseId"] = previous_root
        new_case["version"] = version + 1
        new_case["status"] = "draft"
        new_case["publishedAt"] = None
        new_case["phases"] = build_draft_phases(new_id, identity)
        new_case["attachments"] = [
            remap_attachment(attachment, media_by_id)
            for attachment in old_case.get("attachments", [])
        ]
        cases.append({**copy.deepcopy(entry), "case": new_case})

    articles = copy.deepcopy(source["articles"])
    for article in articles:
        for page in article.get("pages", []):
            if "caseIds" not in page:
                continue
            scoped_ids = page["caseIds"]
            if not isinstance(scoped_ids, list):
                raise ValueError("Article caseIds must be a list")
            try:
                page["caseIds"] = [case_map[str(case_id).lower()] for case_id in scoped_ids]
            except KeyError as exc:
                raise ValueError("Article references an unknown source case") from exc

    media = copy.deepcopy(source["media"])
    for item in media:
        old_case_id = str(item.get("caseId", "")).lower()
        if old_case_id not in case_map:
            raise ValueError("Media references an unknown source case")
        item["caseId"] = case_map[old_case_id]
        item["id"] = str(item["id"]).lower()
        item["file"] = f"media/{item['id']}.webp"

    package_payload = {
        "cases": cases,
        "articles": articles,
        "media": media,
    }
    package_id = canonical_sha256(package_payload)
    clinical_review = build_clinical_review(cases)
    manifest = {
        "formatVersion": 1,
        "packageId": package_id,
        "cases": cases,
        "articles": articles,
        "media": media,
        "clinicalReview": clinical_review,
    }
    return manifest, case_map


def write_review_files(output: Path, manifest: dict[str, Any], source_package_id: str, case_map: dict[str, str]) -> None:
    entries = []
    for entry in manifest["cases"]:
        case = entry["case"]
        entries.append({
            "caseId": case["id"],
            "sourceCaseId": case["sourceCaseId"],
            "sourceDocument": entry.get("sourceDocument"),
            "phaseCount": len(case.get("phases", [])),
            "criterionIds": [criterion["id"] for phase in case.get("phases", []) for criterion in phase.get("rubric", [])],
        })
    draft_review = build_draft_review(manifest["packageId"], entries)
    draft_review["contentSha256"] = manifest["clinicalReview"]["contentSha256"]
    (output / "draft-review.json").write_text(json.dumps(draft_review, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Clinical review draft",
        "",
        "This private revision is application-authored draft content and is not clinician-approved.",
        "The source case descriptions, registered media and attributed reference material were copied for review; no source case was overwritten.",
        "",
        f"- Source package: `{source_package_id}`",
        f"- Review package: `{manifest['packageId']}`",
        f"- Clinical review status: `{manifest['clinicalReview']['status']}`",
        f"- Registered media: {len(manifest['media'])}",
        f"- Reference sources: {len(manifest['articles'])}",
        "",
        "## Case and source mapping",
        "",
        "| Draft case | Previous case | Source document | Phases |",
        "| --- | --- | --- | ---: |",
    ]
    for entry in entries:
        lines.append(f"| `{entry['caseId']}` | `{entry['sourceCaseId']}` | `{entry['sourceDocument']}` | {entry['phaseCount']} |")
    lines.extend(["", "## Phase checklist", ""])
    for entry in manifest["cases"]:
        case = entry["case"]
        lines.extend([f"### {case['title']} (`{case['id']}`)", ""])
        for phase in case.get("phases", []):
            lines.append(f"- Phase {phase['order']}: **{phase['title']}** — {phase['goal']}")
            lines.append(f"  - Starter: {phase['starterQuestion']}")
            for criterion in phase.get("rubric", []):
                lines.append(f"  - `{criterion['id']}`: {criterion['text']}")
        lines.append("")
    lines.extend([
        "## Required clinician review",
        "",
        "- Verify every criterion against the supplied case record and image provenance.",
        "- Confirm that observations, interpretations, associations and causal claims remain distinct.",
        "- Confirm reveal text does not disclose an unshown image finding or diagnosis.",
        "- Confirm case-scoped interview passages remain attributed opinions.",
        "- Only an explicit approval update may make this revision publishable.",
    ])
    (output / "review.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def build(source_dir: Path, output_dir: Path) -> dict[str, Any]:
    source = absolute_directory(source_dir, "Source pack")
    output = output_dir.expanduser().resolve()
    if output == source or source in output.parents:
        raise ValueError("Output directory must not overwrite or sit inside the source pack")
    if output.exists():
        raise ValueError("Output directory already exists; refusing to overwrite it")

    source_manifest = load_manifest(source)
    manifest, case_map = transform_manifest(source_manifest)
    output.mkdir(parents=True)
    try:
        copy_media(source, output, manifest["media"])
        (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        write_review_files(output, manifest, source_manifest["packageId"], case_map)
        report = {
            "sourcePackageId": source_manifest["packageId"],
            "packageId": manifest["packageId"],
            "output": str(output),
            "cases": len(manifest["cases"]),
            "media": len(manifest["media"]),
            "articles": len(manifest["articles"]),
            "clinicalReviewStatus": manifest["clinicalReview"]["status"],
            "caseIdMap": case_map,
        }
        (output / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return report
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Existing private material pack")
    parser.add_argument("--output", type=Path, required=True, help="New private output directory")
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
