"""Case 1 clinical-feedback profile for private clinician review.

This is an application-authored teaching draft grounded in Jessica Hoe's
confirmed Case 1 source and rule changes.  It is not clinical approval and it
does not make a live-model call or write to a remote system.  The profile is
kept separate from the generic Case 2 and Case 3 templates so the integration
script can opt into it explicitly.
"""

from copy import deepcopy


def _criterion(criterion_id, text, reveal_text):
    """Build a structured criterion with the fields required by the publisher."""
    return {
        "id": criterion_id,
        "text": text,
        "revealText": reveal_text,
    }


CASE1_TITLE = "Case 1"
CASE1_CLOSING_QUESTION = (
    "Looking back over the whole case, which prognostic factor had the biggest impact "
    "on the management of the impacted maxillary canine, and why?"
)

CASE1_FEEDBACK_PHASE_TEMPLATES = [
    {
        "title": "Observe the records",
        "goal": "Describe what you see in the records, then say what you think the main problem is and how sure you can be from these records alone.",
        "rubric": [
            _criterion(
                "p1-patient-context",
                "Records the 22-year-old patient's chief complaint of crooked teeth and no relevant medical history.",
                "She's 22, her concern is crooked teeth, and she has no relevant medical history.",
            ),
            _criterion(
                "p1-23-crowding",
                "Identifies missing #23 together with severe upper-arch crowding and moderate lower-arch crowding.",
                "The upper left canine, #23, is missing from the arch. There's severe crowding in the upper arch and moderate crowding in the lower.",
            ),
            _criterion(
                "p1-occlusion-two-findings",
                "Names at least two relevant occlusal findings, such as a Class III incisor relationship, bilateral Class I molars, #22/#33 crossbite, or a lateral open bite.",
                "She has a Class III incisor relationship, Class I molars on both sides, a crossbite at #22/#33, and lateral open bites at #13/#43 and #24/#34.",
            ),
            _criterion(
                "p1-provisional-buccopalatal",
                "Forms a provisional palatal-versus-buccal inference for #23 by combining the OPG with the anterior occlusal view and palatal palpation.",
                "A canine bulge can be felt on the palatal side at #23. On the occlusal film the crown moves in the same direction as the beam compared with the OPG. Both point to a palatal position.",
            ),
            _criterion(
                "p1-opg-limit",
                "Acknowledges that an OPG alone cannot definitively establish bucco-palatal position, so the location remains provisional until corroborated.",
                "An OPG is a 2D image, so on its own it can't show whether the canine is buccal or palatal. Palpation and the shift between the two films support a palatal position, but only 3D imaging can confirm it.",
            ),
        ],
        "starterQuestion": "Looking through the records, what do you notice about this patient's malocclusion?",
        "exampleQuestions": [
            "Looking at the arch, which teeth would you expect to see that you can't?",
            "How would you describe the bite?",
            "If a tooth hasn't erupted, how would you work out where it is from these records?",
            "How much can an OPG alone tell you about where a tooth sits?",
        ],
        "tutorGuidance": [
            "Keep the recorded context separate from interpretation: the 22-year-old patient reports crooked teeth and has no relevant medical history in this source.",
            "Record missing #23, severe upper-arch crowding, moderate lower-arch crowding, and at least two relevant occlusal findings before inferring position.",
            "Use the OPG, anterior occlusal view, and palatal palpation together for a provisional palatal-versus-buccal inference; an OPG alone is not definitive.",
            "Do not present the provisional inference as a confirmed CBCT finding or invent an examination result.",
        ],
        "acceptedExtras": [
            {
                "id": "p1-extra-parallax",
                "text": "Uses a parallax or tube-shift check as a bonus way to test the provisional bucco-palatal inference.",
            },
            {
                "id": "p1-extra-third-molars",
                "text": "Notes third-molar status as useful contextual information without making it a requirement.",
            },
        ],
        "tutorMoves": [],
        "noProgressLimit": 2,
        "phaseCeiling": 5,
    },
    {
        "title": "Localise the problem",
        "goal": "Use the CBCT to confirm where the unerupted tooth is located, and what each record can and can't show you.",
        "rubric": [
            _criterion(
                "p2-cbct-palatal-location",
                "Uses the supplied CBCT record to confirm the provisional palatal location of #23.",
                "The CBCT shows #23 in the mid-alveolus and confirms the palatal position suggested by palpation and the 2D films.",
            ),
            _criterion(
                "p2-crown-buccal-surface",
                "Distinguishes location from orientation: #23's crown buccal surface faces buccally.",
                "The crown's buccal surface faces buccally.",
            ),
            _criterion(
                "p2-not-rotated",
                "States that #23 is not rotated, rather than treating a palatal location as evidence of rotation.",
                "So the crown isn't rotated. Where a tooth sits and which way it faces are separate things: #23 sits palatally but faces the normal way.",
            ),
            _criterion(
                "p2-no-22-24-resorption",
                "Records no root resorption of #22 or #24 on the supplied CBCT finding.",
                "There's no root resorption on #22 or #24.",
            ),
        ],
        "starterQuestion": "How would you work out exactly where #23 is located, and what can each of the records tell you about that?",
        "exampleQuestions": [
            "What does the CBCT show about where #23 is?",
            "Which way does the crown of #23 face?",
            "How can you tell from the CBCT whether #23 is rotated?",
            "What do the roots of #22 and #24 look like on the CBCT?",
        ],
        "tutorGuidance": [
            "Treat the supplied CBCT record as the source-backed confirmation of a palatal #23; never claim the model read image pixels.",
            "Keep location and rotation separate: a palatal location does not mean the crown is rotated, and the crown's buccal surface faces buccally.",
            "Record no resorption of #22 or #24, and do not invent root findings outside the supplied record.",
        ],
        "acceptedExtras": [],
        "tutorMoves": [],
        "noProgressLimit": 2,
        "phaseCeiling": 5,
    },
    {
        "title": "Assess the prognosis",
        "goal": "Weigh what makes it more or less likely that the tooth can be brought safely into the arch.",
        "rubric": [
            _criterion(
                "p3-local-prognosis",
                "Assesses prognosis from the local canine, its root, and adjacent teeth rather than from age alone.",
                "The crown is superficial, the root shape is uncomplicated, and the neighbouring roots show no resorption, so the local prognosis for bringing #23 into the arch is favourable.",
            ),
            _criterion(
                "p3-adult-ankylosis",
                "Includes adult age and ankylosis risk when judging whether #23 movement is feasible.",
                "At 22 the eruptive potential is lower than in an adolescent, and the tooth could be ankylosed, so whether it can move needs testing early.",
            ),
            _criterion(
                "p3-test-movement",
                "Recognises a #23 test-movement checkpoint before committing to or extracting #24 when trying to retain #23; #24 space creation is not required before the test, and absent movement supports removing #23 while retaining #24.",
                "Before extracting #24, expose #23 and apply an orthodontic force to check it moves. If it doesn't move, remove #23 and keep #24 instead.",
            ),
            _criterion(
                "p3-crowding-final-space",
                "Recognises that the upper and lower crowding require space for final alignment without using that need to bypass the #23 movement test.",
                "The severe upper crowding means space will be needed to bring #23 into its final position, but only after you've confirmed it can move.",
            ),
        ],
        "starterQuestion": "How likely is it that #23 can be brought into the arch, and what makes it more or less likely?",
        "exampleQuestions": [
            "What about the tooth and its neighbours makes it easier or harder to bring into the arch?",
            "Would your view change if this patient were 13 instead of 22?",
            "How would you find out whether #23 can move before committing to the full plan?",
            "Where would the space for #23 come from in this upper arch?",
        ],
        "tutorGuidance": [
            "Assess prognosis from the local canine, root, and adjacent teeth together with adult age and ankylosis risk; do not reduce it to one factor.",
            "Use a test movement of #23 as the checkpoint before committing to or extracting #24 when retention of #23 is being considered.",
            "Crowding requires space for final alignment, but do not require #24 space creation before the movement test; absent movement supports removing #23 and retaining #24.",
        ],
        "acceptedExtras": [],
        "tutorMoves": [],
        "noProgressLimit": 2,
        "phaseCeiling": 5,
    },
    {
        "title": "Build the problem list",
        "goal": "Pull everything together into a list of the problems a treatment plan would need to address, not just the unerupted tooth.",
        "rubric": [
            _criterion(
                "p4-skeletal-classiii-lowangle",
                "Includes the source Class III, low-angle pattern with a retrusive maxilla.",
                "Skeletally, she's Class III on a low-angle base because of a retrusive maxilla.",
            ),
            _criterion(
                "p4-incisor-compensation",
                "Identifies incisor compensation as part of the dental presentation.",
                "Her incisors have compensated for the skeletal pattern: the uppers are proclined and the lowers upright.",
            ),
            _criterion(
                "p4-both-arch-crowding",
                "Includes severe upper-arch and moderate lower-arch crowding in the problem list.",
                "There's severe crowding in the upper arch and moderate crowding in the lower, and each needs addressing.",
            ),
            _criterion(
                "p4-occlusion",
                "Includes relevant occlusion, such as Class III incisors, bilateral Class I molars, #22/#33 crossbite, or a lateral open bite.",
                "The bite problems to address include the Class III incisor relationship, the crossbite at #22/#33 and the lateral open bites.",
            ),
            _criterion(
                "p4-patient-concerns",
                "Includes the patient's concern about crooked teeth and links the proposed priorities to patient concerns.",
                "Her main concern is crooked teeth, so your problem list should connect back to that.",
            ),
        ],
        "starterQuestion": "Putting everything together, what problems does this patient have that a treatment plan would need to address?",
        "exampleQuestions": [
            "What do the ceph findings tell you about her skeletal pattern?",
            "How have her front teeth compensated for the skeletal pattern?",
            "Beyond the canine, what else would your plan have to deal with?",
            "Of these problems, which matters most to her?",
            "How would her soft-tissue profile affect your treatment considerations?",
        ],
        "tutorGuidance": [
            "Keep the source Class III, low-angle retrusive-maxilla pattern distinct from incisor compensation and the occlusal findings.",
            "Include severe upper and moderate lower crowding, relevant occlusion, and the patient's crooked-teeth concern in one integrated list.",
            "Third-molar status is a useful bonus context only and is not a required problem-list item.",
        ],
        "acceptedExtras": [
            {
                "id": "p4-extra-third-molars",
                "text": "Adds third-molar status as a bonus contextual consideration without making it required.",
            },
        ],
        "tutorMoves": [],
        "noProgressLimit": 2,
        "phaseCeiling": 5,
    },
    {
        "title": "Compare management options",
        "goal": "Put forward a treatment plan for both arches, justify it, and weigh it against the alternatives.",
        "rubric": [
            _criterion(
                "p5-both-arch-plan",
                "Gives one justified extraction plan that explicitly addresses both the upper and lower arches; one coherent plan is sufficient.",
                "Given the crowding in both arches, a plan needs two extractions in the upper arch and two premolar extractions in the lower.",
            ),
            _criterion(
                "p5-upper-extraction-choice",
                "Justifies either #23 extraction or #24 extraction as the upper-arch choice; both choices are acceptable when tied to the evidence.",
                "In the upper left, either keep #23 and extract #24, or remove #23 and keep #24. #24 already sits where #23 should be and is similar in width and colour to #13, but its gum line won't match #13, so her smile line needs checking.",
            ),
            _criterion(
                "p5-remaining-premolar-choice",
                "Specifies and justifies the remaining premolar choice as first premolars or second premolars rather than treating the selection as fixed.",
                "The other three extractions are premolars, for example #14, #34 and #44. They can be first or second premolars.",
            ),
            _criterion(
                "p5-movement-before-24",
                "Sequences the chosen plan appropriately: if retaining #23, test movement before committing to or extracting #24, without requiring #24 space creation first; directly choosing remove-#23/retain-#24 does not require a retention movement test.",
                "If you keep #23, test that it moves before extracting #24. If it doesn't move, remove #23 and keep #24.",
            ),
        ],
        "starterQuestion": "What treatment plan would you propose for both arches, and why?",
        "exampleQuestions": [
            "Which teeth would you extract, and why?",
            "What would you want to know about #23 before deciding which tooth to extract?",
            "What's your Plan B, and why isn't it your Plan A?",
            "Would the final result look very different if you kept #23 rather than removed it?",
            "If she wanted the quickest, most predictable option, how would that change your plan?",
        ],
        "tutorGuidance": [
            "Require one justified plan that addresses both arches; do not require two alternative plans when one plan is coherent and evidence-linked.",
            "Accept either #23 extraction or #24 extraction as the upper-arch choice, and accept first or second premolars when justified for the remaining space plan.",
            "When retaining #23, assess its movement before committing to or extracting #24; do not require #24 space creation before the test, and accept removing #23 while retaining #24 if movement is absent.",
            "One justified direct remove-#23/retain-#24 plan that addresses both arches is complete; the phase goal's invitation to weigh alternatives does not require a second plan or a comparison with retaining #23 and extracting #24.",
            "For faculty evaluation, p5-movement-before-24 is not applicable when the learner directly chooses remove-#23/retain-#24; treat it as satisfied for completion in that branch. Apply that criterion only when the learner chooses to retain #23 and extract #24, where movement must be tested first.",
            "The crown is palatal, superficial and reachable from the palatal side, so an open palatal exposure is appropriate.",
            "Carry forward the supplied Phase 2 finding: #23 is palatally located, its crown buccal surface faces buccally, it is not rotated, and no #22/#24 root resorption is recorded. Do not reinterpret a buccal crown surface, bracket position, or exposure route in an interview as a buccally located canine; location and orientation are separate.",
        ],
        "acceptedExtras": [
            {
                "id": "p5-extra-second-plan",
                "text": "Offers a second alternative extraction plan as a bonus; it is not required when the primary plan is justified.",
            },
            {
                "id": "p5-extra-no-bond-22",
                "text": "Considers not bonding #22 while #23 remains impacted as a bonus management detail.",
            },
        ],
        "tutorMoves": [],
        "noProgressLimit": 2,
        "phaseCeiling": 5,
    },
    {
        "title": "Review the plan",
        "goal": "Picture where treatment should end up, and what would make you change course along the way.",
        "rubric": [
            _criterion(
                "p6-anticipated-outcome",
                "Defends an anticipated outcome by linking it to the chosen both-arch extraction and alignment plan and the patient's concerns.",
                "If #23 is kept, it ends up in the arch where #24 was, with the crowding resolved. If #23 is removed, #24 takes its place.",
            ),
            _criterion(
                "p6-checkpoint-reconsideration",
                "States a reassessment checkpoint relevant to the chosen plan; if retaining #23, absent movement triggers the remove-#23/retain-#24 fallback, while direct #23 extraction does not require testing its retention.",
                "The key checkpoint is testing whether #23 moves. The premolar hasn't been extracted yet at that point, so if #23 doesn't move you can still switch to removing it and keeping #24.",
            ),
            _criterion(
                "p6-evidence-tradeoffs",
                "Acknowledges the principal evidence-based trade-off or uncertainty that could change the anticipated outcome.",
                "The main uncertainty is whether #23 will move, given her age and the risk of ankylosis. For the removal plan, it's how the uneven gum line of #24 looks when she smiles.",
            ),
        ],
        "starterQuestion": "Picture the end of treatment under your plan. Where does each tooth that matters end up?",
        "exampleQuestions": [
            "Working backwards from that end result, is there anything in your plan you'd change?",
            "What would tell you partway through that the plan isn't working?",
            "If #23 doesn't move when you test it, what would you do next?",
            "What's the main uncertainty in your plan?",
        ],
        "tutorGuidance": [
            "Defend an anticipated outcome rather than promising a guaranteed result, and link it to the chosen plan, evidence, and patient concerns.",
            "Make the #23 movement checkpoint and reconsideration rule explicit; absent movement supports removing #23 while retaining #24.",
            "Keep optional second plans, third-molar discussion, and no-bonding #22 as bonus details rather than hidden requirements.",
            "Carry forward the supplied Phase 2 palatal #23 location with a buccally facing, unrotated crown and no recorded #22/#24 root resorption; do not confuse crown orientation or a possible exposure route with canine location.",
        ],
        "acceptedExtras": [],
        "tutorMoves": [
            {
                "id": "p6-closing-reflection",
                "strategy": "reflect",
                "question": CASE1_CLOSING_QUESTION,
            },
        ],
        "noProgressLimit": 2,
        "phaseCeiling": 5,
    },
]


def build_case1_feedback_phases(case_id, id_factory):
    """Return fresh Case 1 phases with deterministic factory-generated IDs.

    ``id_factory`` is supplied by the caller so the profile can use the same
    UUID namespace and revision identity scheme as the surrounding importer.
    Criterion and accepted-extra IDs are authored stable IDs; only phase IDs
    depend on the caller's case identity.
    """
    phases = []
    for order, template in enumerate(CASE1_FEEDBACK_PHASE_TEMPLATES, 1):
        phase = deepcopy(template)
        phase.update({
            "id": id_factory(f"{case_id}:phase:{order}"),
            "caseId": case_id,
            "order": order,
        })
        phases.append(phase)
    return phases


__all__ = ["CASE1_CLOSING_QUESTION", "CASE1_FEEDBACK_PHASE_TEMPLATES", "CASE1_TITLE", "build_case1_feedback_phases"]
