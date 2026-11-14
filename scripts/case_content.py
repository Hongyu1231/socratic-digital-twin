"""Load and apply a per-case teaching content file (for example content/second-molars/case-1.json).

A content file holds the clinician-authored phases, record unlock rules,
clinical findings and correction policy for one case. It is bound to its
source "Description of Case N.docx" by SHA-256, never by filename, so the
content can only be applied to the case it was written for. A content file
may also pin the clinician's tutor script it was transcribed from
(scriptDocument + scriptDocumentSha256), and may carry hidden tutor-only
expert notes that are appended to the case's expertNotes.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
from typing import Any, Callable

FORMAT_VERSION = 1
MAX_CONTENT_BYTES = 1024 * 1024
# The tutor reads at most this many characters of a case's expertNotes
# (lib/materials/retrieval.ts), so merged notes must fit inside it.
MAX_TUTOR_EXPERT_NOTES = 6000
ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
# Mirrors TUTOR_STRATEGIES in publish-teaching-materials.mjs.
STRATEGIES = {"probe", "challenge", "clarify", "scaffold", "reflect"}

CONTENT_KEYS = {"formatVersion", "id", "title", "sourceDocument", "sourceDocumentSha256", "correctionProbes",
                "records", "findings", "phases", "authoringNotes", "scriptDocument", "scriptDocumentSha256",
                "expertNotes"}
PHASE_KEYS = {"title", "goal", "starterQuestion", "exampleQuestions", "rubric", "acceptedExtras",
              "tutorGuidance", "tutorMoves", "noProgressLimit", "phaseCeiling"}


def _text(value: Any, label: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{label} must be non-empty text of at most {limit} characters")
    return value


def _ident(value: Any, label: str) -> str:
    _text(value, label, 100)
    if not ID_RE.fullmatch(value):
        raise ValueError(f"{label} is not a valid id")
    return value


def _keys(value: Any, allowed: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"{label} has unknown fields: {sorted(unknown)}")
    return value


def validate_content(content: Any) -> dict[str, Any]:
    _keys(content, CONTENT_KEYS, "Content file")
    if content.get("formatVersion") != FORMAT_VERSION:
        raise ValueError("Content file format is unsupported")
    _ident(content.get("id"), "Content id")
    # Limits mirror the app's runtime schemas (lib/schemas.ts), which are
    # stricter than the publisher, so a content file that passes here loads.
    _text(content.get("title"), "Content title", 160)
    _text(content.get("sourceDocument"), "Content sourceDocument", 500)
    if not isinstance(content.get("sourceDocumentSha256"), str) or not SHA256_RE.fullmatch(content["sourceDocumentSha256"]):
        raise ValueError("Content sourceDocumentSha256 must be a lowercase SHA-256")
    if ("scriptDocument" in content) != ("scriptDocumentSha256" in content):
        raise ValueError("Content scriptDocument and scriptDocumentSha256 must be given together")
    if "scriptDocument" in content:
        _text(content["scriptDocument"], "Content scriptDocument", 500)
        if not isinstance(content["scriptDocumentSha256"], str) or not SHA256_RE.fullmatch(content["scriptDocumentSha256"]):
            raise ValueError("Content scriptDocumentSha256 must be a lowercase SHA-256")
    if "expertNotes" in content:
        _text(content["expertNotes"], "Content expertNotes", MAX_TUTOR_EXPERT_NOTES)
    if content.get("correctionProbes") not in (1, 2):
        raise ValueError("Content correctionProbes must be 1 or 2")
    phases = content.get("phases")
    if not isinstance(phases, list) or not 1 <= len(phases) <= 12:
        raise ValueError("Content must have 1 to 12 phases")
    phase_count = len(phases)

    records = _keys(content.get("records"), {"defaultUnlockPhase", "overrides"}, "Content records")
    _unlock(records.get("defaultUnlockPhase"), phase_count, "Default record unlock phase")
    for index, override in enumerate(records.get("overrides", [])):
        _keys(override, {"titleContains", "unlockPhase"}, f"Record override {index + 1}")
        _text(override.get("titleContains"), "Record override titleContains", 160)
        _unlock(override.get("unlockPhase"), phase_count, "Record override unlock phase")

    finding_ids: set[str] = set()
    for index, finding in enumerate(content.get("findings", [])):
        _keys(finding, {"id", "title", "text", "unlockPhase"}, f"Finding {index + 1}")
        fid = _ident(finding.get("id"), "Finding id")
        if fid in finding_ids:
            raise ValueError(f"Duplicate finding id {fid}")
        finding_ids.add(fid)
        _text(finding.get("title"), "Finding title", 160)
        _text(finding.get("text"), "Finding text", 1500)
        _unlock(finding.get("unlockPhase"), phase_count, "Finding unlock phase")

    seen: set[str] = set()
    for order, phase in enumerate(phases, 1):
        label = f"Phase {order}"
        _keys(phase, PHASE_KEYS, label)
        _text(phase.get("title"), f"{label} title", 120)
        _text(phase.get("goal"), f"{label} goal", 500)
        _text(phase.get("starterQuestion"), f"{label} starterQuestion", 500)
        questions = _list(phase.get("exampleQuestions"), f"{label} exampleQuestions", 32)
        if not questions:
            raise ValueError(f"{label} needs at least one example question")
        for question in questions:
            _text(question, f"{label} example question", 500)
        rubric = _list(phase.get("rubric"), f"{label} rubric", 32)
        if not rubric:
            raise ValueError(f"{label} needs at least one criterion")
        criterion_ids = set()
        for criterion in rubric:
            _keys(criterion, {"id", "text", "revealText"}, f"{label} criterion")
            cid = _ident(criterion.get("id"), f"{label} criterion id")
            _text(criterion.get("text"), f"{label} criterion text", 500)
            _text(criterion.get("revealText"), f"{label} reveal text", 500)
            if cid in seen:
                raise ValueError(f"Duplicate criterion id {cid}")
            seen.add(cid)
            criterion_ids.add(cid)
        for extra in _list(phase.get("acceptedExtras", []), f"{label} acceptedExtras", 32):
            _keys(extra, {"id", "text"}, f"{label} accepted extra")
            eid = _ident(extra.get("id"), f"{label} accepted extra id")
            _text(extra.get("text"), f"{label} accepted extra text", 500)
            if eid in seen:
                raise ValueError(f"Duplicate criterion or extra id {eid}")
            seen.add(eid)
        for item in _list(phase.get("tutorGuidance", []), f"{label} tutorGuidance", 20):
            _text(item, f"{label} tutor guidance item", 500)
        for move in _list(phase.get("tutorMoves", []), f"{label} tutorMoves", 20):
            _keys(move, {"id", "strategy", "question", "targetCriterionId"}, f"{label} tutor move")
            _text(move.get("id"), f"{label} tutor move id", 80)
            if move.get("strategy") not in STRATEGIES:
                raise ValueError(f"{label} tutor move strategy is invalid")
            question = _text(move.get("question"), f"{label} tutor move question", 500)
            if question.count("?") != 1:
                raise ValueError(f"{label} tutor move must contain exactly one question")
            if "targetCriterionId" in move and move["targetCriterionId"] not in criterion_ids:
                raise ValueError(f"{label} tutor move targets a criterion outside its phase")
        if not isinstance(phase.get("noProgressLimit"), int) or not 1 <= phase["noProgressLimit"] <= 4:
            raise ValueError(f"{label} noProgressLimit must be 1 to 4")
        if not isinstance(phase.get("phaseCeiling"), int) or not 2 <= phase["phaseCeiling"] <= 12:
            raise ValueError(f"{label} phaseCeiling must be 2 to 12")
    return content


def _list(value: Any, label: str, limit: int) -> list[Any]:
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError(f"{label} must be a list of at most {limit} items")
    return value


def _unlock(value: Any, phase_count: int, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= phase_count:
        raise ValueError(f"{label} must be a phase between 1 and {phase_count}")
    return value


def load_content(path: Path) -> dict[str, Any]:
    path = Path(path)
    if not path.is_file() or path.stat().st_size > MAX_CONTENT_BYTES:
        raise ValueError("Content file is missing or too large")
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Content file is not valid JSON") from exc
    return validate_content(content)


def _docx_sections():
    spec = importlib.util.spec_from_file_location(
        "case_content_importer", Path(__file__).with_name("import-teaching-materials.py"))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.docx_sections


def verify_source_document(content: dict[str, Any], entry: dict[str, Any], docx_path: Path) -> None:
    """Bind the content to one case: the docx hash must match, and so must its text."""

    data = Path(docx_path).read_bytes()
    if hashlib.sha256(data).hexdigest() != content["sourceDocumentSha256"]:
        raise ValueError("Source document does not match the content file's SHA-256")
    description, background = _docx_sections()(data)
    if description != entry["case"].get("description") or background != entry.get("expertNotes"):
        raise ValueError("Source document does not match the selected case")


def verify_script_document(content: dict[str, Any], script_path: Path | None) -> None:
    """When the content pins its tutor script, the supplied script must match that SHA-256."""

    if "scriptDocumentSha256" not in content:
        if script_path is not None:
            raise ValueError("Content file does not pin a tutor script; remove --script-docx")
        return
    if script_path is None:
        raise ValueError("Content file pins a tutor script; pass it with --script-docx")
    if hashlib.sha256(Path(script_path).read_bytes()).hexdigest() != content["scriptDocumentSha256"]:
        raise ValueError("Tutor script does not match the content file's scriptDocumentSha256")


def merge_expert_notes(source_notes: str, content: dict[str, Any]) -> str:
    """Append the content's hidden expert notes after the source document's summary."""

    extra = content.get("expertNotes")
    if not extra:
        return source_notes
    merged = f"{source_notes.rstrip()}\n\n{extra.strip()}" if source_notes.strip() else extra.strip()
    if len(merged.strip()) > MAX_TUTOR_EXPERT_NOTES:
        raise ValueError(f"Merged expert notes exceed the tutor's {MAX_TUTOR_EXPERT_NOTES}-character limit")
    return merged


def build_content_phases(content: dict[str, Any], case_id: str, id_factory: Callable[[str], str]) -> list[dict[str, Any]]:
    phases = []
    for order, template in enumerate(content["phases"], 1):
        phase = copy.deepcopy(template)
        phase.setdefault("acceptedExtras", [])
        phase.setdefault("tutorGuidance", [])
        phase.setdefault("tutorMoves", [])
        phase.update({"id": id_factory(f"{case_id}:phase:{order}"), "caseId": case_id, "order": order})
        phases.append(phase)
    return phases


def record_unlock_phase(content: dict[str, Any], attachment_title: str) -> int:
    title = attachment_title.lower()
    for override in content["records"].get("overrides", []):
        if override["titleContains"].lower() in title:
            return override["unlockPhase"]
    return content["records"]["defaultUnlockPhase"]


def apply_content(case: dict[str, Any], content: dict[str, Any], id_factory: Callable[[str], str]) -> dict[str, Any]:
    """Return a copy of the case with the content's phases, records, findings and policy."""

    result = copy.deepcopy(case)
    result["title"] = content["title"]
    result["phases"] = build_content_phases(content, result["id"], id_factory)
    for attachment in result.get("attachments", []):
        attachment["unlockPhase"] = record_unlock_phase(content, attachment["title"])
        attachment["unlockOnRequest"] = False
    result["correctionProbes"] = content["correctionProbes"]
    result["findings"] = [
        {**copy.deepcopy(finding), "unlockOnRequest": False} for finding in content.get("findings", [])
    ]
    return result


__all__ = ["apply_content", "build_content_phases", "load_content", "merge_expert_notes", "record_unlock_phase",
           "validate_content", "verify_script_document", "verify_source_document"]
