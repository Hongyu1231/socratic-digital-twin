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

    def test_later_decisions_preserve_phase_two_location_without_leaking_it_in_phase_one(self):
        for phase in (self.phases[4], self.phases[5]):
            guidance = " ".join(phase["tutorGuidance"]).lower()
            self.assertIn("phase 2", guidance)
            self.assertIn("palatal", guidance)
            self.assertIn("crown", guidance)
            self.assertIn("orientation", guidance)
            self.assertIn("exposure route", guidance)
        initial = " ".join(self.phases[0]["tutorGuidance"]).lower()
        self.assertNotIn("not rotated", initial)
        self.assertNotIn("no #22/#24 root resorption", initial)

    def test_titles_goals_and_opening_questions_match_the_approved_wording(self):
        self.assertEqual(MODULE.CASE1_TITLE, "Case 1")
        approved = [
            ("Observe the records", "Describe what you see in the records, then say what you think the main problem is and how sure you can be from these records alone.", "Looking through the records, what do you notice about this patient's malocclusion?"),
            ("Localise the problem", "Use the CBCT to confirm where the unerupted tooth is located, and what each record can and can't show you.", "How would you work out exactly where #23 is located, and what can each of the records tell you about that?"),
            ("Assess the prognosis", "Weigh what makes it more or less likely that the tooth can be brought safely into the arch.", "How likely is it that #23 can be brought into the arch, and what makes it more or less likely?"),
            ("Build the problem list", "Pull everything together into a list of the problems a treatment plan would need to address, not just the unerupted tooth.", "Putting everything together, what problems does this patient have that a treatment plan would need to address?"),
            ("Compare management options", "Put forward a treatment plan for both arches, justify it, and weigh it against the alternatives.", "What treatment plan would you propose for both arches, and why?"),
            ("Review the plan", "Picture where treatment should end up, and what would make you change course along the way.", "Picture the end of treatment under your plan. Where does each tooth that matters end up?"),
        ]
        self.assertEqual(
            [(phase["title"], phase["goal"], phase["starterQuestion"]) for phase in self.phases],
            approved,
        )

    def test_closing_reflection_and_palatal_exposure_guidance(self):
        self.assertEqual([phase["tutorMoves"] for phase in self.phases[:5]], [[]] * 5)
        self.assertEqual(self.phases[5]["tutorMoves"], [{
            "id": "p6-closing-reflection",
            "strategy": "reflect",
            "question": "Looking back over the whole case, which prognostic factor had the biggest impact on the management of the impacted maxillary canine, and why?",
        }])
        guidance = self.phases[4]["tutorGuidance"]
        self.assertIn("The crown is palatal, superficial and reachable from the palatal side, so an open palatal exposure is appropriate.", guidance)
        self.assertNotIn("surgical route conditional", " ".join(guidance))

    def test_reveal_texts_match_the_approved_wording_exactly(self):
        approved = {
            "p1-patient-context": "She's 22, her concern is crooked teeth, and she has no relevant medical history.",
            "p1-23-crowding": "The upper left canine, #23, is missing from the arch. There's severe crowding in the upper arch and moderate crowding in the lower.",
            "p1-occlusion-two-findings": "She has a Class III incisor relationship, Class I molars on both sides, a crossbite at #22/#33, and lateral open bites at #13/#43 and #24/#34.",
            "p1-provisional-buccopalatal": "A canine bulge can be felt on the palatal side at #23. On the occlusal film the crown moves in the same direction as the beam compared with the OPG. Both point to a palatal position.",
            "p1-opg-limit": "An OPG is a 2D image, so on its own it can't show whether the canine is buccal or palatal. Palpation and the shift between the two films support a palatal position, but only 3D imaging can confirm it.",
            "p2-cbct-palatal-location": "The CBCT shows #23 in the mid-alveolus and confirms the palatal position suggested by palpation and the 2D films.",
            "p2-crown-buccal-surface": "The crown's buccal surface faces buccally.",
            "p2-not-rotated": "So the crown isn't rotated. Where a tooth sits and which way it faces are separate things: #23 sits palatally but faces the normal way.",
            "p2-no-22-24-resorption": "There's no root resorption on #22 or #24.",
            "p3-local-prognosis": "The crown is superficial, the root shape is uncomplicated, and the neighbouring roots show no resorption, so the local prognosis for bringing #23 into the arch is favourable.",
            "p3-adult-ankylosis": "At 22 the eruptive potential is lower than in an adolescent, and the tooth could be ankylosed, so whether it can move needs testing early.",
            "p3-test-movement": "Before extracting #24, expose #23 and apply an orthodontic force to check it moves. If it doesn't move, remove #23 and keep #24 instead.",
            "p3-crowding-final-space": "The severe upper crowding means space will be needed to bring #23 into its final position, but only after you've confirmed it can move.",
            "p4-skeletal-classiii-lowangle": "Skeletally, she's Class III on a low-angle base because of a retrusive maxilla.",
            "p4-incisor-compensation": "Her incisors have compensated for the skeletal pattern: the uppers are proclined and the lowers upright.",
            "p4-both-arch-crowding": "There's severe crowding in the upper arch and moderate crowding in the lower, and each needs addressing.",
            "p4-occlusion": "The bite problems to address include the Class III incisor relationship, the crossbite at #22/#33 and the lateral open bites.",
            "p4-patient-concerns": "Her main concern is crooked teeth, so your problem list should connect back to that.",
            "p5-both-arch-plan": "Given the crowding in both arches, a plan needs two extractions in the upper arch and two premolar extractions in the lower.",
            "p5-upper-extraction-choice": "In the upper left, either keep #23 and extract #24, or remove #23 and keep #24. #24 already sits where #23 should be and is similar in width and colour to #13, but its gum line won't match #13, so her smile line needs checking.",
            "p5-remaining-premolar-choice": "The other three extractions are premolars, for example #14, #34 and #44. They can be first or second premolars.",
            "p5-movement-before-24": "If you keep #23, test that it moves before extracting #24. If it doesn't move, remove #23 and keep #24.",
            "p6-anticipated-outcome": "If #23 is kept, it ends up in the arch where #24 was, with the crowding resolved. If #23 is removed, #24 takes its place.",
            "p6-checkpoint-reconsideration": "The key checkpoint is testing whether #23 moves. The premolar hasn't been extracted yet at that point, so if #23 doesn't move you can still switch to removing it and keeping #24.",
            "p6-evidence-tradeoffs": "The main uncertainty is whether #23 will move, given her age and the risk of ankylosis. For the removal plan, it's how the uneven gum line of #24 looks when she smiles.",
        }
        actual = {item["id"]: item["revealText"] for phase in self.phases for item in phase["rubric"]}
        self.assertEqual(actual, approved)

    def test_example_questions_match_the_approved_wording_exactly(self):
        approved = [
            [
                "Looking at the arch, which teeth would you expect to see that you can't?",
                "How would you describe the bite?",
                "If a tooth hasn't erupted, how would you work out where it is from these records?",
                "How much can an OPG alone tell you about where a tooth sits?",
            ],
            [
                "What does the CBCT show about where #23 is?",
                "Which way does the crown of #23 face?",
                "How can you tell from the CBCT whether #23 is rotated?",
                "What do the roots of #22 and #24 look like on the CBCT?",
            ],
            [
                "What about the tooth and its neighbours makes it easier or harder to bring into the arch?",
                "Would your view change if this patient were 13 instead of 22?",
                "How would you find out whether #23 can move before committing to the full plan?",
                "Where would the space for #23 come from in this upper arch?",
            ],
            [
                "What do the ceph findings tell you about her skeletal pattern?",
                "How have her front teeth compensated for the skeletal pattern?",
                "Beyond the canine, what else would your plan have to deal with?",
                "Of these problems, which matters most to her?",
                "How would her soft-tissue profile affect your treatment considerations?",
            ],
            [
                "Which teeth would you extract, and why?",
                "What would you want to know about #23 before deciding which tooth to extract?",
                "What's your Plan B, and why isn't it your Plan A?",
                "Would the final result look very different if you kept #23 rather than removed it?",
                "If she wanted the quickest, most predictable option, how would that change your plan?",
            ],
            [
                "Working backwards from that end result, is there anything in your plan you'd change?",
                "What would tell you partway through that the plan isn't working?",
                "If #23 doesn't move when you test it, what would you do next?",
                "What's the main uncertainty in your plan?",
            ],
        ]
        self.assertEqual([phase["exampleQuestions"] for phase in self.phases], approved)
        for phase in self.phases:
            for question in phase["exampleQuestions"]:
                self.assertEqual(question.count("?"), 1)
                self.assertNotIn("\u2014", question)

    def test_student_visible_text_is_plain_and_carries_no_internal_label(self):
        for phase in self.phases:
            visible = [phase["title"], phase["goal"], phase["starterQuestion"]]
            visible += [item["revealText"] for item in phase["rubric"]]
            visible += [move["question"] for move in phase["tutorMoves"]]
            visible += phase["exampleQuestions"]
            for text in visible:
                self.assertFalse(text.startswith("Review point:"))
                self.assertNotIn("Suppose a colleague", text)
                self.assertNotIn("\u2014", text)
            for text in visible[2:]:
                self.assertNotIn(phase["goal"], text)


if __name__ == "__main__":
    unittest.main()
