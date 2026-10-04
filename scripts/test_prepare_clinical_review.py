"""Synthetic-only tests for the private clinical-review pack revision."""

from __future__ import annotations

import importlib.util
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "prepare_clinical_review",
    Path(__file__).with_name("prepare-clinical-review.py"),
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ClinicalReviewPreparationTests(unittest.TestCase):
    def make_pack(self, root: Path) -> dict:
        media_id = "11111111-1111-4111-8111-111111111111"
        media_bytes = b"synthetic-webp-bytes"
        (root / "media").mkdir()
        (root / "media" / f"{media_id}.webp").write_bytes(media_bytes)
        old_case_id = "22222222-2222-4222-8222-222222222222"
        manifest = {
            "formatVersion": 1,
            "packageId": "a" * 64,
            "cases": [{
                "case": {
                    "id": old_case_id,
                    "title": "Case 1 - Synthetic canine assessment",
                    "description": "Source-backed synthetic description.",
                    "difficulty": "advanced",
                    "status": "available",
                    "version": 1,
                    "sourceCaseId": None,
                    "publishedAt": None,
                    "learningObjectives": ["Use evidence carefully."],
                    "phases": [{
                        "id": "33333333-3333-4333-8333-333333333333",
                        "caseId": old_case_id,
                        "order": 1,
                        "title": "Legacy phase",
                        "goal": "Legacy goal",
                        "rubric": ["legacy rubric"],
                        "starterQuestion": "Legacy question",
                        "exampleQuestions": [],
                        "tutorMoves": [],
                    }],
                    "attachments": [{
                        "id": media_id,
                        "kind": "image",
                        "title": "X-ray (OPG)",
                        "description": "Synthetic record",
                        "url": "/api/materials/old-reference",
                    }],
                    "isTestFixture": False,
                },
                "expertNotes": "Private source note.",
                "sourceDocument": "Description of Case 1.docx",
            }],
            "articles": [{
                "id": "article-1",
                "title": "Synthetic source",
                "filename": "source.pdf",
                "sha256": "b" * 64,
                "pages": [{"page": 1, "text": "Synthetic source passage.", "caseIds": [old_case_id]}],
            }],
            "media": [{
                "id": media_id,
                "caseId": old_case_id,
                "file": f"media/{media_id}.webp",
                "mimeType": "image/webp",
                "sha256": MODULE.sha256_bytes(media_bytes),
                "width": 10,
                "height": 10,
            }],
        }
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def test_builds_new_private_lineage_and_remaps_references(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            source.mkdir()
            original = self.make_pack(source)
            output = base / "review"

            report = MODULE.build(source, output)
            revised = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            old_case = original["cases"][0]["case"]
            new_case = revised["cases"][0]["case"]

            self.assertNotEqual(report["packageId"], original["packageId"])
            self.assertNotEqual(new_case["id"], old_case["id"])
            self.assertEqual(new_case["sourceCaseId"], old_case["id"])
            self.assertEqual(new_case["version"], 2)
            self.assertEqual(new_case["status"], "draft")
            self.assertNotEqual(new_case["phases"][0]["id"], old_case["phases"][0]["id"])
            self.assertTrue(all(phase["caseId"] == new_case["id"] for phase in new_case["phases"]))
            self.assertEqual(new_case["attachments"][0]["id"], original["media"][0]["id"])
            self.assertEqual(new_case["attachments"][0]["url"], f"/api/materials/{original['media'][0]['id']}")
            self.assertEqual(revised["media"][0]["id"], original["media"][0]["id"])
            self.assertEqual(revised["media"][0]["caseId"], new_case["id"])
            self.assertEqual(revised["articles"][0]["pages"][0]["caseIds"], [new_case["id"]])
            self.assertEqual(
                (output / "media" / f"{original['media'][0]['id']}.webp").read_bytes(),
                (source / "media" / f"{original['media'][0]['id']}.webp").read_bytes(),
            )
            self.assertEqual(revised["clinicalReview"]["status"], "pending")
            self.assertIsNone(revised["clinicalReview"]["reviewer"])
            self.assertIsNone(revised["clinicalReview"]["approvedAt"])
            self.assertEqual(
                revised["clinicalReview"]["contentSha256"],
                MODULE.clinical_content_sha256(revised["cases"]),
            )
            self.assertIn("Required clinician review", (output / "review.md").read_text(encoding="utf-8"))
            self.assertEqual(json.loads((source / "manifest.json").read_text(encoding="utf-8")), original)

    def test_refuses_to_overwrite_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            source.mkdir()
            self.make_pack(source)
            output = base / "review"
            output.mkdir()
            with self.assertRaises(ValueError):
                MODULE.build(source, output)

    def test_case1_only_feedback_preserves_sources_and_excludes_other_cases(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            source.mkdir()
            original = self.make_pack(source)
            first = original["cases"][0]
            case1_id = first["case"]["id"]
            case2_id = "44444444-4444-4444-8444-444444444444"
            second = copy.deepcopy(first)
            second["case"].update({"id": case2_id, "title": "Case 2", "attachments": []})
            second["sourceDocument"] = "Description of Case 2.docx"
            original["cases"].append(second)
            original["articles"][0]["pages"].extend([
                {"page": 2, "text": "Case 2 only", "caseIds": [case2_id]},
                {"page": 3, "text": "Shared source", "caseIds": [case1_id, case2_id]},
                {"page": 4, "text": "Unscoped literature"},
            ])
            cbct_id = "55555555-5555-4555-8555-555555555555"
            cbct = {**copy.deepcopy(original["media"][0]), "id": cbct_id, "file": f"media/{cbct_id}.webp"}
            (source / cbct["file"]).write_bytes(b"synthetic-webp-bytes")
            original["media"].append(cbct)
            first["case"]["attachments"].append({**copy.deepcopy(first["case"]["attachments"][0]), "id": cbct_id, "title": "X-ray (CBCT)", "url": f"/api/materials/{cbct_id}"})
            (source / "manifest.json").write_text(json.dumps(original), encoding="utf-8")
            output = base / "feedback"
            MODULE.build(source, output, case_id=case1_id, case1_feedback=True)
            revised = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(len(revised["cases"]), 1)
            case = revised["cases"][0]["case"]
            self.assertEqual(case["sourceCaseId"], case1_id)
            self.assertEqual([item["unlockPhase"] for item in case["attachments"]], [1, 2])
            self.assertEqual(case["findings"][0]["unlockPhase"], 1)
            self.assertIn("palatal", case["findings"][0]["text"])
            self.assertEqual({phase["phaseCeiling"] for phase in case["phases"]}, {5})
            self.assertTrue(any(phase["acceptedExtras"] for phase in case["phases"]))
            pages = revised["articles"][0]["pages"]
            self.assertEqual([page["page"] for page in pages], [1, 3, 4])
            self.assertNotIn(case2_id, json.dumps(revised))
            self.assertEqual(revised["clinicalReview"]["status"], "pending")
            self.assertEqual(revised["clinicalReview"]["contentSha256"], MODULE.clinical_content_sha256(revised["cases"]))
            self.assertIn("Bonus only", (output / "review.md").read_text(encoding="utf-8"))
            self.assertEqual(json.loads((source / "manifest.json").read_text(encoding="utf-8")), original)

    def test_requires_explicit_case1_selection_and_rejects_a_different_document(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            original = self.make_pack(source)
            with self.assertRaises(ValueError):
                MODULE.transform_manifest(original, case1_feedback=True)
            with self.assertRaises(ValueError):
                MODULE.transform_manifest(original, case_id="99999999-9999-4999-8999-999999999999", case1_feedback=True)
            original["cases"][0]["sourceDocument"] = "Description of Case 2.docx"
            with self.assertRaises(ValueError):
                MODULE.transform_manifest(original, case_id=original["cases"][0]["case"]["id"], case1_feedback=True)

    def test_a_changed_feedback_profile_receives_a_new_case_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            original = self.make_pack(Path(directory))
            case_id = original["cases"][0]["case"]["id"]
            first, _ = MODULE.transform_manifest(original, case_id=case_id, case1_feedback=True)
            builder = MODULE.build_case1_feedback_phases
            def revised_profile(case_id, id_factory):
                phases = builder(case_id, id_factory)
                phases[0]["goal"] += " Revised review wording."
                return phases
            with patch.object(MODULE, "build_case1_feedback_phases", side_effect=revised_profile):
                second, _ = MODULE.transform_manifest(original, case_id=case_id, case1_feedback=True)
            self.assertNotEqual(first["cases"][0]["case"]["id"], second["cases"][0]["case"]["id"])


if __name__ == "__main__":
    unittest.main()
