"""Focused structural and content tests for the Case 1 feedback profile."""

import importlib.util
from pathlib import Path
import unittest
import uuid


SPEC = importlib.util.spec_from_file_location(
    "case1_clinical_feedback",
    Path(__file__).with_name("case1_clinical_feedback.py"),
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def identity(value):
    return str(uuid.uuid5(uuid.UUID("b5cbb8d5-3b0a-4370-bc7b-5f6de3a66055"), value))


class Case1ClinicalFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.case_id = "case-1-review"
        self.phases = MODULE.build_case1_feedback_phases(self.case_id, identity)

    def test_returns_six_ordered_stable_factory_id_phases(self):
        again = MODULE.build_case1_feedback_phases(self.case_id, identity)
        self.assertEqual(self.phases, again)
        self.assertEqual(len(self.phases), 6)
        self.assertEqual([phase["order"] for phase in self.phases], list(range(1, 7)))
        self.assertTrue(all(phase["caseId"] == self.case_id for phase in self.phases))
        self.assertEqual(
            [phase["id"] for phase in self.phases],
            [identity(f"{self.case_id}:phase:{order}") for order in range(1, 7)],
        )

    def test_all_phases_have_structured_criteria_questions_limits_and_moves(self):
        criterion_ids = []
        extra_ids = []
        for phase in self.phases:
            self.assertEqual(phase["noProgressLimit"], 2)
            self.assertEqual(phase["phaseCeiling"], 5)
            self.assertIsInstance(phase["tutorMoves"], list)
            self.assertEqual((phase["starterQuestion"].count("?") + phase["starterQuestion"].count("？")), 1)
            for question in phase["exampleQuestions"]:
                self.assertEqual(question.count("?") + question.count("？"), 1)
            for criterion in phase["rubric"]:
                self.assertEqual(set(criterion), {"id", "text", "revealText"})
                criterion_ids.append(criterion["id"])
            for extra in phase["acceptedExtras"]:
                self.assertEqual(set(extra), {"id", "text"})
                extra_ids.append(extra["id"])
            for move in phase["tutorMoves"]:
                self.assertEqual(move["question"].count("?") + move["question"].count("？"), 1)
        self.assertEqual(len(criterion_ids), len(set(criterion_ids)))
        self.assertEqual(len(extra_ids), len(set(extra_ids)))
        self.assertTrue(set(criterion_ids).isdisjoint(extra_ids))

    def test_phase_five_requires_both_arches_but_one_plan_and_optional_alternatives(self):
        phase = self.phases[4]
        rubric = " ".join(item["text"] for item in phase["rubric"]).lower()
        guidance = " ".join(phase["tutorGuidance"]).lower()
        self.assertIn("both the upper and lower arches", rubric)
        self.assertIn("one coherent plan is sufficient", rubric)
        self.assertIn("do not require two alternative plans", guidance)
        self.assertIn("retention movement test is not applicable", guidance)
        self.assertIn("directly choosing remove-#23/retain-#24", rubric)
        self.assertIn("second alternative extraction plan", " ".join(item["text"] for item in phase["acceptedExtras"]).lower())

    def test_optional_extras_are_separate_from_required_criteria(self):
        phase_by_order = {phase["order"]: phase for phase in self.phases}
        self.assertEqual(
            {item["id"] for item in phase_by_order[1]["acceptedExtras"]},
            {"p1-extra-parallax", "p1-extra-third-molars"},
        )
        self.assertEqual(
            {item["id"] for item in phase_by_order[5]["acceptedExtras"]},
            {"p5-extra-second-plan", "p5-extra-no-bond-22"},
        )
        for phase in self.phases:
            required = {item["id"] for item in phase["rubric"]}
            extras = {item["id"] for item in phase["acceptedExtras"]}
            self.assertTrue(required.isdisjoint(extras))

    def test_location_and_rotation_are_distinct_and_source_limited(self):
        phase = self.phases[1]
        criteria = {item["id"]: item["text"].lower() for item in phase["rubric"]}
        self.assertIn("p2-cbct-palatal-location", criteria)
        self.assertIn("p2-not-rotated", criteria)
        self.assertIn("palatal", criteria["p2-cbct-palatal-location"])
        self.assertIn("not rotated", criteria["p2-not-rotated"])
        combined = " ".join(criteria.values()) + " " + " ".join(phase["tutorGuidance"]).lower()
        self.assertIn("image pixels", combined)
        self.assertIn("#22 or #24", combined)

    def test_movement_checkpoint_precedes_number_24_and_has_fallback(self):
        phase_text = " ".join(
            item["text"] for item in self.phases[2]["rubric"] + self.phases[4]["rubric"]
        ).lower()
        guidance_text = " ".join(self.phases[2]["tutorGuidance"] + self.phases[4]["tutorGuidance"]).lower()
        combined = phase_text + " " + guidance_text
        self.assertIn("before committing to or extracting #24", combined)
        self.assertIn("#24 space creation is not required before", combined)
        self.assertIn("removing #23 while retaining #24", combined)
        self.assertIn("movement", combined)


if __name__ == "__main__":
    unittest.main()
