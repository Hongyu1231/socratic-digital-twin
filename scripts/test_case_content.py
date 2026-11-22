"""Content contract tests for every case content file, plus the canine Case 1 profile."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

import case_content  # noqa: E402
import script_text  # noqa: E402
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
# The private 9 Nov tutor script docx stays out of the repo; its plain-text extract (made by
# scripts/script_text.py) is committed next to the content file, so the fidelity test runs everywhere.
# When the docx is available (MOLAR_CASE1_SCRIPT_DOCX or the default private folder), the test also
# confirms the extract was generated from it exactly.
MOLAR_CASE1_SCRIPT_EXTRACT = REPO / "content" / "second-molars" / "case-1.script-9nov.txt"
MOLAR_CASE1_SCRIPT_DIR = Path.home() / "socratic-molar-source" / "2026-11-09"
CARLA_21_NOV = "Dr Carla Andreina, email of 21 Nov 2026"
CARLA_22_NOV = "Dr Carla Andreina, WhatsApp of 22 Nov 2026"
MOLAR_CASE1_V1_ID = "6fc7718f-0093-51c9-adc1-b78a5e7580bb"  # the published version 1 lineage root
# Content fields that are pipeline metadata, not script wording.
NON_SCRIPT_FIELDS = {"formatVersion", "id", "newLineage", "revisionOf", "title", "sourceDocument", "sourceDocumentSha256",
                     "scriptDocument", "scriptDocumentSha256", "correctionProbes", "records",
                     "authoringNotes", "approvedScriptDifferences"}
EXPERT_BASIS_LABEL = re.compile(r"^Expert basis \(tutor only, never show to students\)(?:, part (\d+) of (\d+))?: ")


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def script_texts(content: dict) -> dict[str, str]:
    """Map a JSON Pointer to every content string that should be the script's wording.

    Ids are pipeline additions. Expert basis items carry a pipeline label instead of the
    script's "Expert basis:" and may be split into numbered parts, so their parts are
    rejoined and the script's label restored under the pointer of part 1.
    """

    texts: dict[str, str] = {}

    def walk(value, pointer):
        if isinstance(value, dict):
            for key, item in value.items():
                if key != "id":
                    walk(item, f"{pointer}/{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{pointer}/{index}")
        elif isinstance(value, str):
            texts[pointer] = value
        elif not isinstance(value, (int, bool)):
            raise AssertionError(f"Unexpected value at {pointer}")

    for key, value in content.items():
        if key not in NON_SCRIPT_FIELDS:
            walk(value, f"/{key}")
    for phase_index, phase in enumerate(content["phases"]):
        parts = []
        for index, item in enumerate(phase["tutorGuidance"]):
            match = EXPERT_BASIS_LABEL.match(item)
            if match:
                parts.append((index, match, item[match.end():]))
                del texts[f"/phases/{phase_index}/tutorGuidance/{index}"]
        numbers = [(int(m.group(1)) if m.group(1) else None, int(m.group(2)) if m.group(2) else None)
                   for _, m, _ in parts]
        expected = [(None, None)] if len(parts) == 1 else [(n, len(parts)) for n in range(1, len(parts) + 1)]
        assert numbers == expected, f"Phase {phase_index + 1} Expert basis parts are {numbers}"
        texts[f"/phases/{phase_index}/tutorGuidance/{parts[0][0]}"] = "Expert basis: " + " ".join(p for *_, p in parts)
    return texts


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
        # Version 2 revises the published version 1 lineage root.
        self.assertEqual(self.content["revisionOf"], {"caseId": MOLAR_CASE1_V1_ID, "version": 1})
        self.assertNotIn("newLineage", self.content)

    def test_all_ids_are_prefixed(self):
        for phase in self.content["phases"]:
            for item in phase["rubric"] + phase["acceptedExtras"] + phase["tutorMoves"]:
                self.assertTrue(item["id"].startswith("sm1-"), item["id"])

    def test_case_rules_are_in_the_right_phases(self):
        for order, phase in enumerate(self.content["phases"], 1):
            guidance = " ".join(phase["tutorGuidance"])
            self.assertIn(RULE_INVESTIGATIONS, guidance)
            self.assertIn(RULE_NO_ANSWER, guidance)
            # Removed from Phase 6 by Dr Carla on 22 Nov; it was never in another phase.
            self.assertNotIn(RULE_END_POSITION, guidance)
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

    def test_records_exactly_the_approved_script_differences(self):
        differences = self.content["approvedScriptDifferences"]
        self.assertEqual([(d["location"], case_content.script_difference_kind(d)) for d in differences], [
            ("/phases/0/rubric/3/revealText", "replaced"),
            ("/phases/4/tutorGuidance/2", "replaced"),
            ("/phases/0/rubric/1/text", "replaced"),
            ("/phases/0/tutorGuidance/1", "replaced"),
            ("/phases/0/exampleQuestions/5", "added"),
            ("/phases/1/rubric/0/text", "replaced"),
            ("/phases/1/tutorGuidance/2", "replaced"),
            ("/phases/1/exampleQuestions/1", "replaced"),
            ("/phases/1/rubric/2/text", "replaced"),
            ("/phases/1/rubric/2/revealText", "replaced"),
            ("/phases/3/rubric/0/text", "replaced"),
            ("/phases/5/tutorGuidance/1", "removed"),
            ("/phases/5/tutorGuidance/7", "removed"),
            ("/phases/5/exampleQuestions/0", "removed"),
            ("/phases/5/exampleQuestions/1", "removed"),
            ("/phases/5/rubric/0/revealText", "removed"),
            ("/phases/5/rubric/0/text", "moved"),
        ])
        self.assertEqual([d["source"] for d in differences], [CARLA_21_NOV] * 2 + [CARLA_22_NOV] * 15)
        self.assertEqual(self.content["phases"][0]["rubric"][3]["id"], "sm1-1.4")
        self.assertIn("no caries seen on the distal surfaces of the second molars", differences[0]["newText"])
        self.assertTrue(differences[1]["newText"].startswith("Extraction is the expected main plan."))
        self.assertNotIn("first molar", self.content["phases"][0]["rubric"][3]["revealText"])

    def test_criterion_6_1_is_now_a_bonus_extra(self):
        phase6 = self.content["phases"][5]
        self.assertEqual([c["id"] for c in phase6["rubric"]], ["sm1-6.2", "sm1-6.3", "sm1-6.4"])
        extra = phase6["acceptedExtras"][-1]
        self.assertEqual(extra["id"], "sm1-p6-extra-4")
        self.assertEqual(set(extra), {"id", "text"})
        self.assertTrue(extra["text"].startswith("Describes the end point and works backwards from it"))

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


class ApprovedScriptDifferenceValidationTests(unittest.TestCase):
    def setUp(self):
        self.content = copy.deepcopy(case_content.load_content(MOLAR_CASE1))

    def assert_refused(self, message):
        with self.assertRaisesRegex(ValueError, message):
            case_content.validate_content(self.content)

    def test_location_must_hold_the_new_text(self):
        self.content["phases"][0]["rubric"][3]["revealText"] = self.content["approvedScriptDifferences"][0]["oldText"]
        self.assert_refused("is not its newText")

    def test_location_must_resolve(self):
        self.content["approvedScriptDifferences"][0]["location"] = "/phases/0/rubric/99/revealText"
        self.assert_refused("does not point into the content file")

    def test_entries_need_exactly_the_four_fields(self):
        del self.content["approvedScriptDifferences"][0]["source"]
        self.assert_refused("must have exactly")

    def test_locations_are_unique(self):
        self.content["approvedScriptDifferences"].append(copy.deepcopy(self.content["approvedScriptDifferences"][0]))
        self.assert_refused("repeats location")

    def test_needs_a_pinned_script(self):
        del self.content["scriptDocument"], self.content["scriptDocumentSha256"]
        self.assert_refused("pinned scriptDocument")

    def entry(self, kind):
        return next(d for d in self.content["approvedScriptDifferences"]
                    if case_content.script_difference_kind(d) == kind)

    def test_each_kind_is_found_from_its_fields(self):
        for kind in ("replaced", "added", "removed", "moved"):
            self.assertEqual(case_content.script_difference_kind(self.entry(kind)), kind)
        self.assertIsNone(case_content.script_difference_kind({"location": "/title", "source": "x"}))
        self.assertIsNone(case_content.script_difference_kind(
            {"location": "/title", "oldText": "a", "newText": "b", "movedTo": "/title", "source": "x"}))

    def test_an_entry_with_mixed_fields_is_refused(self):
        self.entry("moved")["newText"] = "x"
        self.assert_refused("must have exactly")

    def test_added_location_must_hold_the_new_text(self):
        self.content["phases"][0]["exampleQuestions"][5] = "A different question?"
        self.assert_refused("is not its newText")

    def test_added_location_must_resolve(self):
        self.content["phases"][0]["exampleQuestions"].pop()
        self.assert_refused("does not point into the content file")

    def test_removed_text_must_be_gone_from_the_content(self):
        self.content["phases"][5]["tutorGuidance"].append(self.entry("removed")["oldText"])
        self.assert_refused("removed oldText is still in the content")

    def test_removed_text_is_found_inside_a_longer_string_and_across_whitespace(self):
        old = self.entry("removed")["oldText"]
        self.content["expertNotes"] += "\n" + old.replace(" ", "\n  ", 1)
        self.assert_refused("removed oldText is still in the content")

    def test_removed_location_need_not_resolve(self):
        self.assertEqual(self.entry("removed")["location"], "/phases/5/tutorGuidance/1")
        self.content["approvedScriptDifferences"][12]["location"] = "/phases/5/tutorGuidance/99"
        case_content.validate_content(self.content)

    def test_locations_must_be_pointers(self):
        self.entry("removed")["location"] = "phases/5/tutorGuidance/1"
        self.assert_refused("is not a JSON Pointer")

    def test_moved_to_must_hold_the_old_text(self):
        self.content["phases"][5]["acceptedExtras"][3]["text"] += " Changed."
        self.assert_refused("is not its oldText")

    def test_moved_to_must_resolve_and_differ_from_location(self):
        moved = self.entry("moved")
        moved["movedTo"] = "/phases/5/acceptedExtras/9/text"
        self.assert_refused("does not point into the content file")
        moved["movedTo"] = moved["location"]
        self.assert_refused("movedTo is the same as location")

    def test_moved_to_cannot_point_at_the_differences(self):
        self.entry("moved")["movedTo"] = "/approvedScriptDifferences/0/oldText"
        self.assert_refused("cannot point at approvedScriptDifferences")


class RevisionOfValidationTests(unittest.TestCase):
    def setUp(self):
        self.content = copy.deepcopy(case_content.load_content(MOLAR_CASE1))

    def assert_refused(self, message):
        with self.assertRaisesRegex(ValueError, message):
            case_content.validate_content(self.content)

    def test_cannot_be_combined_with_new_lineage(self):
        for value in (True, False):
            self.content["newLineage"] = value
            self.assert_refused("both newLineage and revisionOf")

    def test_case_id_must_be_a_lowercase_uuid(self):
        for value in ("not-a-uuid", MOLAR_CASE1_V1_ID.upper(), MOLAR_CASE1_V1_ID.replace("-", ""), 7, None):
            self.content["revisionOf"]["caseId"] = value
            self.assert_refused("caseId must be a lowercase UUID")

    def test_version_must_be_an_integer_of_at_least_1(self):
        for value in (0, -1, 1.0, "1", True, None):
            self.content["revisionOf"]["version"] = value
            self.assert_refused("version must be an integer of at least 1")

    def test_needs_exactly_case_id_and_version(self):
        del self.content["revisionOf"]["version"]
        self.assert_refused("needs caseId and version")
        self.content["revisionOf"].update(version=1, extra=1)
        self.assert_refused("unknown fields")
        self.content["revisionOf"] = MOLAR_CASE1_V1_ID
        self.assert_refused("must be an object")


class MolarCase1ScriptFidelityTests(unittest.TestCase):
    """The content matches the pinned 9 Nov tutor script word for word, except at the approved differences."""

    @classmethod
    def setUpClass(cls):
        cls.content = case_content.load_content(MOLAR_CASE1)
        cls.source, cls.source_sha256, body = script_text.read_extract(MOLAR_CASE1_SCRIPT_EXTRACT)
        cls.script = normalise(body)

    def test_extract_is_of_the_pinned_script(self):
        self.assertEqual(self.source, self.content["scriptDocument"])
        self.assertEqual(self.source_sha256, self.content["scriptDocumentSha256"])

    def test_extract_matches_the_docx_when_it_is_available(self):
        docx = Path(os.environ.get("MOLAR_CASE1_SCRIPT_DOCX") or MOLAR_CASE1_SCRIPT_DIR / self.content["scriptDocument"])
        if not docx.is_file():
            self.skipTest(f"private tutor script not found at {docx}; the committed extract is used alone")
        self.assertEqual(hashlib.sha256(docx.read_bytes()).hexdigest(), self.content["scriptDocumentSha256"],
                         f"{docx} does not match the content file's scriptDocumentSha256")
        self.assertEqual(MOLAR_CASE1_SCRIPT_EXTRACT.read_text(encoding="utf-8"), script_text.extract(docx),
                         "the committed extract is not exactly what scripts/script_text.py makes from the docx")

    def test_no_docx_is_committed_beside_the_content(self):
        self.assertEqual(list((REPO / "content").glob("**/*.docx")), [])

    def by_kind(self, content=None):
        kinds = {"replaced": {}, "added": {}, "removed": {}, "moved": {}}
        for difference in (content or self.content)["approvedScriptDifferences"]:
            kinds[case_content.script_difference_kind(difference)][difference["location"]] = difference
        return kinds

    def check_against_script(self, content):
        kinds = self.by_kind(content)
        texts = script_texts(content)
        # Replaced and added entries hold their newText in the content; removed and moved
        # entries name where the text was in the previous version, so they are not content.
        approved = {**kinds["replaced"], **kinds["added"]}
        self.assertLessEqual(set(approved), set(texts), "an approved difference points outside the script wording")
        unrecorded = [pointer for pointer, text in texts.items()
                      if pointer not in approved and normalise(text) not in self.script]
        self.assertEqual(unrecorded, [], "content differs from the 9 Nov script without an approvedScriptDifferences entry")
        for pointer, difference in approved.items():
            self.assertNotIn(normalise(difference["newText"]), self.script, f"{pointer} is not a difference from the script")
        for pointer, difference in {**kinds["replaced"], **kinds["removed"], **kinds["moved"]}.items():
            self.assertIn(normalise(difference["oldText"]), self.script, f"{pointer} oldText is not the script's wording")
        content_texts = [normalise(text) for text in texts.values()]
        for pointer, difference in kinds["removed"].items():
            self.assertFalse(any(normalise(difference["oldText"]) in text for text in content_texts),
                             f"{pointer} is recorded as removed but is still in the content")
        for pointer, difference in kinds["moved"].items():
            self.assertEqual(texts.get(difference["movedTo"]), difference["oldText"], f"{pointer} movedTo does not hold it")

    def test_content_differs_from_the_script_only_where_recorded(self):
        self.check_against_script(self.content)
        self.assertEqual({kind: len(entries) for kind, entries in self.by_kind().items()},
                         {"replaced": 10, "added": 1, "removed": 5, "moved": 1})

    def assert_caught(self, content):
        with self.assertRaises(AssertionError):
            self.check_against_script(content)

    def test_a_wrong_replaced_entry_is_caught(self):
        content = copy.deepcopy(self.content)
        self.by_kind(content)["replaced"]["/phases/1/tutorGuidance/2"]["oldText"] = "Words that are not in the script."
        self.assert_caught(content)

    def test_a_wrong_added_entry_is_caught(self):
        content = copy.deepcopy(self.content)
        # Recording script wording as "added" is not a difference from the script.
        script_question = content["phases"][0]["exampleQuestions"][0]
        content["phases"][0]["exampleQuestions"][5] = script_question
        self.by_kind(content)["added"]["/phases/0/exampleQuestions/5"]["newText"] = script_question
        self.assert_caught(content)

    def test_a_wrong_removed_entry_is_caught(self):
        content = copy.deepcopy(self.content)
        self.by_kind(content)["removed"]["/phases/5/exampleQuestions/0"]["oldText"] = "A question the script never had?"
        self.assert_caught(content)
        content = copy.deepcopy(self.content)
        # A text recorded as removed that is still in the content.
        kept = content["phases"][5]["exampleQuestions"][0]
        self.by_kind(content)["removed"]["/phases/5/exampleQuestions/0"]["oldText"] = kept
        self.assert_caught(content)

    def test_a_wrong_moved_entry_is_caught(self):
        content = copy.deepcopy(self.content)
        moved = self.by_kind(content)["moved"]["/phases/5/rubric/0/text"]
        moved["oldText"] = content["phases"][5]["acceptedExtras"][3]["text"] = "Text that is not in the script."
        self.assert_caught(content)
        content = copy.deepcopy(self.content)
        self.by_kind(content)["moved"]["/phases/5/rubric/0/text"]["movedTo"] = "/phases/5/acceptedExtras/0/text"
        self.assert_caught(content)

    def test_an_unrecorded_addition_is_caught(self):
        content = copy.deepcopy(self.content)
        content["phases"][0]["exampleQuestions"].append("An unrecorded new question?")
        self.assert_caught(content)

    def test_an_unrecorded_change_is_caught(self):
        content = copy.deepcopy(self.content)
        content["phases"][2]["rubric"][0]["revealText"] += " Extra words."
        texts = script_texts(content)
        self.assertNotIn(normalise(texts["/phases/2/rubric/0/revealText"]), self.script)


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
        # the newLineage and revisionOf tests set it explicitly.
        self.content.pop("newLineage", None)
        self.content.pop("revisionOf", None)
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

    def built_case(self, name):
        return json.loads((self.base / name / "manifest.json").read_text(encoding="utf-8"))["cases"][0]["case"]

    def test_content_revision_of_builds_the_next_version_of_that_case(self):
        source_id = json.loads((self.source / "manifest.json").read_text(encoding="utf-8"))["cases"][0]["case"]["id"]
        self.build("plain")
        plain = self.built_case("plain")
        self.assertEqual((plain["sourceCaseId"], plain["version"]), (source_id, 2))
        self.write_content(revisionOf={"caseId": MOLAR_CASE1_V1_ID, "version": 1})
        self.build("v2")
        revised = self.built_case("v2")
        self.assertEqual((revised["sourceCaseId"], revised["version"]), (MOLAR_CASE1_V1_ID, 2))
        self.assertNotEqual(revised["id"], plain["id"])
        self.assertNotEqual(revised["id"], MOLAR_CASE1_V1_ID)
        self.assertNotEqual({p["id"] for p in revised["phases"]}, {p["id"] for p in plain["phases"]})
        self.write_content(revisionOf={"caseId": MOLAR_CASE1_V1_ID, "version": 4})
        self.build("v5")
        later = self.built_case("v5")
        self.assertEqual((later["sourceCaseId"], later["version"]), (MOLAR_CASE1_V1_ID, 5))
        self.assertNotEqual(later["id"], revised["id"])

    def test_revision_of_refuses_the_new_lineage_flag(self):
        self.write_content(revisionOf={"caseId": MOLAR_CASE1_V1_ID, "version": 1})
        with self.assertRaisesRegex(ValueError, "remove --new-lineage"):
            self.build("a", new_lineage=True)
        self.assertFalse((self.base / "a").exists())

    def test_revision_of_and_new_lineage_together_are_refused_by_the_build(self):
        self.write_content(revisionOf={"caseId": MOLAR_CASE1_V1_ID, "version": 1}, newLineage=True)
        with self.assertRaisesRegex(ValueError, "both newLineage and revisionOf"):
            self.build("a", new_lineage=True)
        self.assertFalse((self.base / "a").exists())

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
