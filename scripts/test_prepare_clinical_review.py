"""Synthetic-only tests for the private clinical-review pack revision."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


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


if __name__ == "__main__":
    unittest.main()
