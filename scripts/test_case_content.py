"""Content contract tests for every case content file, plus the canine Case 1 profile."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

import case_content  # noqa: E402
from case1_clinical_feedback import CASE1_FEEDBACK_PHASE_TEMPLATES  # noqa: E402
from test_canine_output_unchanged import REVIEW, synthetic_docx, synthetic_review_pack  # noqa: E402

CONTENT_FILES = sorted((REPO / "content").glob("**/*.json"))
MOLAR_CASE1 = REPO / "content" / "second-molars" / "case-1.json"
RULE_INVESTIGATIONS = "Never suggest or ask about investigations that are not available in the case."
RULE_NO_ANSWER = "Never give the answer because the student asks for it directly."
RULE_END_POSITION = "Ask the student to describe the end position of the teeth before discussing mechanics."
# Length of the "Summary of the case" section in the private 'Description of Case 1.docx'
# (SHA-256 d9033e66..., unchanged on 9 Nov). The docx stays out of the repo, so its
# length is recorded here; the build also refuses merged notes over the limit.
MOLAR_CASE1_DESCRIPTION_SUMMARY_CHARS = 798
TUTOR_EXPERT_NOTES_LIMIT = 6000  # lib/materials/retrieval.ts slices expertNotes to 6,000 characters


def help_cap_and_backups() -> tuple[int, list[str]]:
    """Read the level-2 cap and backup questions from lib/tutor/progression.ts."""

    source = (REPO / "lib" / "tutor" / "progression.ts").read_text(encoding="utf-8")
    cap = int(re.search(r"content\.split\(/\\s\+/\)\.length > (\d+)", source).group(1))
    backups = re.search(r"const question = \[(.*?)\]\s*\.find", source, re.S).group(1)
    return cap, re.findall(r"[\"`]([^\"`]+\?)[\"`]", backups)


def all_phase_sets() -> dict[str, list[dict]]:
    sets = {"canine case1_clinical_feedback": CASE1_FEEDBACK_PHASE_TEMPLATES}
    for path in CONTENT_FILES:
        sets[str(path.relative_to(REPO))] = case_content.load_content(path)["phases"]
    return sets


class HelpCapTests(unittest.TestCase):
    def test_validator_uses_the_runtime_guidance_limit(self):
        content = copy.deepcopy(case_content.load_content(MOLAR_CASE1))
        content["phases"][0]["tutorGuidance"].append("x" * 501)
        with self.assertRaises(ValueError):
            case_content.validate_content(content)

    def test_content_files_exist_and_validate(self):
        self.assertIn(MOLAR_CASE1, CONTENT_FILES)
        for path in CONTENT_FILES:
            case_content.load_content(path)

    def test_every_reveal_plus_longest_backup_fits_the_help_cap(self):
        cap, backups = help_cap_and_backups()
        self.assertEqual(cap, 60)
        self.assertEqual(len(backups), 5)
        for name, phases in all_phase_sets().items():
            for phase in phases:
                questions = [q.replace("${phase.title.toLowerCase()}", phase["title"].lower()) for q in backups]
                for criterion in phase["rubric"]:
                    point = criterion.get("revealText") or criterion["text"]
                    longest = max(len(f"{point} {q}".split()) for q in questions)
                    self.assertLessEqual(longest, cap, f"{name} {criterion['id']} is {longest} words with a backup question")


class MolarCase1ContentTests(unittest.TestCase):
    def setUp(self):
        self.content = case_content.load_content(MOLAR_CASE1)

    def test_identity_records_and_findings(self):
        self.assertEqual(self.content["title"], "Second molars: Case 1")
        self.assertEqual(len(self.content["phases"]), 6)
        self.assertEqual(self.content["records"], {"defaultUnlockPhase": 1, "overrides": []})
        self.assertEqual([finding["unlockPhase"] for finding in self.content["findings"]], [1])
        self.assertEqual(self.content["correctionProbes"], 1)
        # Never published: the first published version must be a lineage root.
        self.assertIs(self.content["newLineage"], True)

    def test_all_ids_are_prefixed(self):
        for phase in self.content["phases"]:
            for item in phase["rubric"] + phase["acceptedExtras"] + phase["tutorMoves"]:
                self.assertTrue(item["id"].startswith("sm1-"), item["id"])

    def test_case_rules_are_in_the_right_phases(self):
        for order, phase in enumerate(self.content["phases"], 1):
            guidance = " ".join(phase["tutorGuidance"])
            self.assertIn(RULE_INVESTIGATIONS, guidance)
            self.assertIn(RULE_NO_ANSWER, guidance)
            self.assertEqual(RULE_END_POSITION in guidance, order == 6)
            self.assertTrue(any(item.startswith("Expert basis (tutor only, never show to students)")
                                for item in phase["tutorGuidance"]))

    def test_follows_the_9_nov_script(self):
        phases = self.content["phases"]
        self.assertEqual(self.content["scriptDocument"], "Molars_Case_1_tutor_script (9Nov26).docx")
        self.assertEqual(self.content["scriptDocumentSha256"],
                         "ed4de82eb56c2759ffdee5c0172c5d712050ec29effd0b0b99af747f4c056bbd")
        # The 9 Nov script shortened 5.1, 5.5 and 6.4 itself, so no full originals are kept.
        self.assertFalse(any(item.startswith("Full reveal for ") for phase in phases for item in phase["tutorGuidance"]))
        self.assertEqual([c["id"] for c in phases[3]["rubric"]], ["sm1-4.1", "sm1-4.2", "sm1-4.3"])
        self.assertIn("retained #83,", phases[3]["rubric"][2]["revealText"])
        self.assertNotIn("#84", json.dumps(phases))

    def test_expert_notes_have_both_sections_and_fit_the_tutor_limit(self):
        notes = self.content["expertNotes"]
        self.assertTrue(notes.startswith("Case summary for the tutor"))
        self.assertIn("\nExpert panel view", notes)
        merged = case_content.merge_expert_notes("x" * MOLAR_CASE1_DESCRIPTION_SUMMARY_CHARS, self.content)
        self.assertLessEqual(len(merged), TUTOR_EXPERT_NOTES_LIMIT)
        self.assertEqual(case_content.MAX_TUTOR_EXPERT_NOTES, TUTOR_EXPERT_NOTES_LIMIT)
        retrieval = (REPO / "lib" / "materials" / "retrieval.ts").read_text(encoding="utf-8")
        self.assertIn(f"expertNotes.trim().slice(0, {TUTOR_EXPERT_NOTES_LIMIT:_})", retrieval)

    def test_merged_expert_notes_over_the_limit_are_refused(self):
        with self.assertRaisesRegex(ValueError, "6000-character"):
            case_content.merge_expert_notes("x" * TUTOR_EXPERT_NOTES_LIMIT, self.content)

    def test_rules_never_reach_canine_content(self):
        canine = json.dumps(CASE1_FEEDBACK_PHASE_TEMPLATES)
        for rule in (RULE_INVESTIGATIONS, RULE_NO_ANSWER, RULE_END_POSITION):
            self.assertNotIn(rule, canine)


class ContentGuardTests(unittest.TestCase):
    """--content is bound to the source docx by hash and text, never by filename."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.source = self.base / "source"
        self.source.mkdir()
        self.case_id = synthetic_review_pack(self.source)
        manifest = json.loads((self.source / "manifest.json").read_text(encoding="utf-8"))
        entry = manifest["cases"][0]
        self.docx = self.base / "Description of Case 1.docx"
        self.docx.write_bytes(synthetic_docx([
            "Information to be presented to the student:", entry["case"]["description"],
            "Summary of the case:", entry["expertNotes"],
        ]))
        self.content = copy.deepcopy(case_content.load_content(MOLAR_CASE1))
        # The revision-path guards below run without the lineage choice;
        # the newLineage tests set it explicitly.
        self.content.pop("newLineage", None)
        self.content["sourceDocumentSha256"] = hashlib.sha256(self.docx.read_bytes()).hexdigest()
        self.script = self.base / "tutor script.docx"
        self.script.write_bytes(synthetic_docx(["Synthetic tutor script."]))
        self.content["scriptDocumentSha256"] = hashlib.sha256(self.script.read_bytes()).hexdigest()
        self.source_notes = entry["expertNotes"]
        self.content_path = self.base / "content.json"
        self.content_path.write_text(json.dumps(self.content), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def build(self, name, **kwargs):
        args = {"case_id": self.case_id, "content_path": self.content_path, "source_docx": self.docx,
                "script_docx": self.script, **kwargs}
        return REVIEW.build(self.source, self.base / name, **args)

    def test_applies_title_phases_records_findings_and_policy(self):
        self.build("out")
        case = json.loads((self.base / "out" / "manifest.json").read_text(encoding="utf-8"))["cases"][0]["case"]
        self.assertEqual(case["title"], "Second molars: Case 1")
        self.assertEqual([phase["order"] for phase in case["phases"]], [1, 2, 3, 4, 5, 6])
        self.assertTrue(all(phase["caseId"] == case["id"] for phase in case["phases"]))
        self.assertEqual({a["unlockPhase"] for a in case["attachments"]}, {1})
        self.assertEqual([f["id"] for f in case["findings"]], ["sm1-partial-eruption"])
        self.assertEqual(case["correctionProbes"], 1)
        self.assertEqual(case["version"], 2)

    def test_same_filename_with_a_different_hash_is_rejected(self):
        self.docx.write_bytes(self.docx.read_bytes() + b"\0")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.build("out")

    def test_matching_hash_for_another_case_is_rejected(self):
        other = self.base / "other.docx"
        other.write_bytes(synthetic_docx([
            "Information to be presented to the student:", "A different case.",
            "Summary of the case:", "Different notes.",
        ]))
        self.content["sourceDocumentSha256"] = hashlib.sha256(other.read_bytes()).hexdigest()
        self.content_path.write_text(json.dumps(self.content), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "selected case"):
            self.build("out", source_docx=other)

    def test_requires_case_id_and_docx_and_excludes_case1_feedback(self):
        with self.assertRaises(ValueError):
            self.build("a", source_docx=None)
        with self.assertRaises(ValueError):
            self.build("b", case1_feedback=True)

    def test_expert_notes_keep_the_source_summary_then_append_both_sections(self):
        self.build("out")
        entry = json.loads((self.base / "out" / "manifest.json").read_text(encoding="utf-8"))["cases"][0]
        self.assertEqual(entry["expertNotes"], self.source_notes + "\n\n" + self.content["expertNotes"])
        self.assertLess(entry["expertNotes"].index("Case summary for the tutor"),
                        entry["expertNotes"].index("Expert panel view"))

    def test_tutor_script_is_required_and_hash_checked(self):
        with self.assertRaisesRegex(ValueError, "--script-docx"):
            self.build("a", script_docx=None)
        self.script.write_bytes(self.script.read_bytes() + b"\0")
        with self.assertRaisesRegex(ValueError, "scriptDocumentSha256"):
            self.build("b")

    def write_content(self, **changes):
        self.content.update(changes)
        self.content_path.write_text(json.dumps(self.content), encoding="utf-8")

    def test_content_new_lineage_with_flag_builds_a_version_1_root(self):
        self.write_content(newLineage=True)
        self.build("out", new_lineage=True)
        case = json.loads((self.base / "out" / "manifest.json").read_text(encoding="utf-8"))["cases"][0]["case"]
        self.assertIsNone(case["sourceCaseId"])
        self.assertEqual(case["version"], 1)
        self.assertEqual(case["title"], "Second molars: Case 1")

    def test_content_and_flag_must_agree(self):
        self.write_content(newLineage=True)
        with self.assertRaisesRegex(ValueError, "pass --new-lineage"):
            self.build("a")
        self.write_content(newLineage=False)
        with self.assertRaisesRegex(ValueError, "remove --new-lineage"):
            self.build("b", new_lineage=True)
        self.content.pop("newLineage")
        self.write_content()
        with self.assertRaisesRegex(ValueError, "remove --new-lineage"):
            self.build("c", new_lineage=True)
        self.assertFalse(any((self.base / name).exists() for name in "abc"))

    def test_new_lineage_value_must_be_boolean(self):
        bad = copy.deepcopy(self.content)
        bad["newLineage"] = "yes"
        with self.assertRaisesRegex(ValueError, "newLineage"):
            case_content.validate_content(bad)

    def test_content_change_gives_new_case_ids(self):
        first = json.loads((self.base / "first" / "manifest.json").read_text()) if self.build("first") else None
        self.content["phases"][0]["goal"] += " Changed."
        self.content_path.write_text(json.dumps(self.content), encoding="utf-8")
        self.build("second")
        second = json.loads((self.base / "second" / "manifest.json").read_text())
        self.assertNotEqual(first["cases"][0]["case"]["id"], second["cases"][0]["case"]["id"])


if __name__ == "__main__":
    unittest.main()
