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


CASE1_FEEDBACK_PHASE_TEMPLATES = [
    {
        "title": "Initial record and provisional localisation",
        "goal": (
            "Record the patient context, eruption and occlusal findings, then form a "
            "provisional palatal-versus-buccal inference for missing #23 while stating "
            "the limits of an OPG alone."
        ),
        "rubric": [
            _criterion(
                "p1-patient-context",
                "Records the 22-year-old patient's chief complaint of crooked teeth and no relevant medical history.",
                "State the recorded 22-year-old patient's context: crooked teeth and no relevant medical history; do not add unrecorded history.",
            ),
            _criterion(
                "p1-23-crowding",
                "Identifies missing #23 together with severe upper-arch crowding and moderate lower-arch crowding.",
                "Identify missing #23 and the recorded severe upper-arch and moderate lower-arch crowding before explaining its significance.",
            ),
            _criterion(
                "p1-occlusion-two-findings",
                "Names at least two relevant occlusal findings, such as a Class III incisor relationship, bilateral Class I molars, #22/#33 crossbite, or a lateral open bite.",
                "Name at least two relevant occlusal findings from the record, choosing from the Class III incisor relationship, bilateral Class I molars, #22/#33 crossbite, or lateral open bite.",
            ),
            _criterion(
                "p1-provisional-buccopalatal",
                "Forms a provisional palatal-versus-buccal inference for #23 by combining the OPG with the anterior occlusal view and palatal palpation.",
                "Use the OPG, anterior occlusal view, and palatal palpation to state a provisional palatal-versus-buccal inference for #23.",
            ),
            _criterion(
                "p1-opg-limit",
                "Acknowledges that an OPG alone cannot definitively establish bucco-palatal position, so the location remains provisional until corroborated.",
                "Explain why an OPG-only bucco-palatal conclusion is not definitive and identify what corroboration makes the inference provisional rather than certain.",
            ),
        ],
        "starterQuestion": "What does the initial record suggest about #23's palatal-versus-buccal position, and what limits that inference?",
        "exampleQuestions": [
            "Which history and examination facts are relevant to this initial assessment?",
            "Which two occlusal findings would you record?",
            "How do the OPG, anterior occlusal view, and palatal palpation support a provisional location?",
            "Why is an OPG-only bucco-palatal conclusion not definitive?",
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
        "title": "CBCT location and orientation",
        "goal": (
            "Use the supplied CBCT finding to confirm #23's palatal location while keeping "
            "location, crown orientation, root findings, and image-source limits distinct."
        ),
        "rubric": [
            _criterion(
                "p2-cbct-palatal-location",
                "Uses the supplied CBCT record to confirm the provisional palatal location of #23.",
                "Use the supplied CBCT record to check and confirm the provisional palatal location of #23.",
            ),
            _criterion(
                "p2-crown-buccal-surface",
                "Distinguishes location from orientation: #23's crown buccal surface faces buccally.",
                "Describe the crown orientation separately from location and state that #23's crown buccal surface faces buccally.",
            ),
            _criterion(
                "p2-not-rotated",
                "States that #23 is not rotated, rather than treating a palatal location as evidence of rotation.",
                "State whether #23 is rotated and explain why palatal location and rotation are separate observations.",
            ),
            _criterion(
                "p2-no-22-24-resorption",
                "Records no root resorption of #22 or #24 on the supplied CBCT finding.",
                "Record the supplied absence of root resorption affecting #22 or #24 without inventing any additional image finding.",
            ),
        ],
        "starterQuestion": "What does the supplied CBCT establish about #23's location, crown orientation, and adjacent-root resorption?",
        "exampleQuestions": [
            "What record supports the conclusion that #23 is palatal?",
            "How is #23's buccal crown surface oriented, and is the tooth rotated?",
            "What does the supplied CBCT record about resorption of #22 and #24?",
            "How does the CBCT confirmation compare with your provisional localisation from the initial records?",
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
        "title": "Local prognosis and a movement checkpoint",
        "goal": (
            "Assess the local and patient-specific prognosis for #23 and define a reversible "
            "movement checkpoint before committing to an irreversible #24 space decision."
        ),
        "rubric": [
            _criterion(
                "p3-local-prognosis",
                "Assesses prognosis from the local canine, its root, and adjacent teeth rather than from age alone.",
                "Explain how the local canine, its root, and adjacent teeth contribute to prognosis, keeping the assessment patient-specific.",
            ),
            _criterion(
                "p3-adult-ankylosis",
                "Includes adult age and ankylosis risk when judging whether #23 movement is feasible.",
                "Relate adult age and possible ankylosis risk to the feasibility and prognosis of moving #23.",
            ),
            _criterion(
                "p3-test-movement",
                "Recognises a #23 test-movement checkpoint before committing to or extracting #24 when trying to retain #23; #24 space creation is not required before the test, and absent movement supports removing #23 while retaining #24.",
                "Describe the #23 movement checkpoint, make clear that #24 extraction or space creation waits when retaining #23, and state the remove-#23/retain-#24 fallback if movement is absent.",
            ),
            _criterion(
                "p3-crowding-final-space",
                "Recognises that the upper and lower crowding require space for final alignment without using that need to bypass the #23 movement test.",
                "Explain why crowding needs space for final alignment while preserving the movement checkpoint before any #24 extraction decision.",
            ),
        ],
        "starterQuestion": "How would you assess #23 prognosis and decide what movement checkpoint should precede an irreversible space decision?",
        "exampleQuestions": [
            "Which local canine, root, and adjacent-tooth factors shape prognosis?",
            "How do adult age and ankylosis risk affect the feasibility of moving #23?",
            "What should be tested before committing to #24 extraction when trying to retain #23?",
            "Why is final-alignment space still needed even though #24 space creation can wait for the test?",
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
        "title": "Integrated problem list",
        "goal": "Integrate the source skeletal, dental, occlusal, and patient-concern findings into a prioritised problem list.",
        "rubric": [
            _criterion(
                "p4-skeletal-classiii-lowangle",
                "Includes the source Class III, low-angle pattern with a retrusive maxilla.",
                "State the source skeletal pattern as Class III and low-angle with a retrusive maxilla, without adding an unrecorded skeletal finding.",
            ),
            _criterion(
                "p4-incisor-compensation",
                "Identifies incisor compensation as part of the dental presentation.",
                "Include incisor compensation in the dental problem list and distinguish it from the skeletal pattern.",
            ),
            _criterion(
                "p4-both-arch-crowding",
                "Includes severe upper-arch and moderate lower-arch crowding in the problem list.",
                "Include both upper-arch severe crowding and lower-arch moderate crowding as separate alignment problems.",
            ),
            _criterion(
                "p4-occlusion",
                "Includes relevant occlusion, such as Class III incisors, bilateral Class I molars, #22/#33 crossbite, or a lateral open bite.",
                "Link the problem list to relevant occlusion, including the recorded Class III incisors, bilateral Class I molars, #22/#33 crossbite, or lateral open bite where applicable.",
            ),
            _criterion(
                "p4-patient-concerns",
                "Includes the patient's concern about crooked teeth and links the proposed priorities to patient concerns.",
                "Connect the problem list and priorities to the patient's crooked-teeth concern rather than presenting a plan detached from patient priorities.",
            ),
        ],
        "starterQuestion": "How would you integrate the source skeletal, dental, occlusal, and patient-concern findings into one problem list?",
        "exampleQuestions": [
            "Which skeletal findings belong in the integrated problem list?",
            "How do incisor compensation and both-arch crowding affect the dental problem list?",
            "Which occlusal findings should be prioritised?",
            "How does the patient's crooked-teeth concern influence your priorities?",
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
        "title": "Justified extraction plan",
        "goal": (
            "Construct one justified extraction plan for both arches, respecting the #23 "
            "movement checkpoint and the conditional upper-arch choices."
        ),
        "rubric": [
            _criterion(
                "p5-both-arch-plan",
                "Gives one justified extraction plan that explicitly addresses both the upper and lower arches; one coherent plan is sufficient.",
                "State one coherent, justified extraction plan for both arches and connect it to crowding, prognosis, occlusion, and patient concerns; a second plan is optional.",
            ),
            _criterion(
                "p5-upper-extraction-choice",
                "Justifies either #23 extraction or #24 extraction as the upper-arch choice; both choices are acceptable when tied to the evidence.",
                "Choose and justify either #23 extraction or #24 extraction for the upper arch, making the evidence and conditional reasoning explicit.",
            ),
            _criterion(
                "p5-remaining-premolar-choice",
                "Specifies and justifies the remaining premolar choice as first premolars or second premolars rather than treating the selection as fixed.",
                "State whether the remaining premolars would be first or second premolars and justify that choice for the selected both-arch plan.",
            ),
            _criterion(
                "p5-movement-before-24",
                "Sequences the chosen plan appropriately: if retaining #23, test movement before committing to or extracting #24, without requiring #24 space creation first; directly choosing remove-#23/retain-#24 does not require a retention movement test.",
                "If retaining #23, test movement before deciding on #24 extraction; absent movement permits remove-#23/retain-#24. A justified direct remove-#23/retain-#24 plan does not require a retention movement test or a second plan.",
            ),
        ],
        "starterQuestion": "What one justified extraction plan would you choose for both arches, and how would the #23 movement checkpoint shape it?",
        "exampleQuestions": [
            "How does your one plan address extraction in both the upper and lower arches?",
            "Why would you choose #23 extraction or #24 extraction for the upper arch?",
            "Would the remaining premolars be first or second premolars, and why?",
            "What must happen before committing to #24 extraction when you are trying to retain #23?",
        ],
        "tutorGuidance": [
            "Require one justified plan that addresses both arches; do not require two alternative plans when one plan is coherent and evidence-linked.",
            "Accept either #23 extraction or #24 extraction as the upper-arch choice, and accept first or second premolars when justified for the remaining space plan.",
            "When retaining #23, assess its movement before committing to or extracting #24; do not require #24 space creation before the test, and accept removing #23 while retaining #24 if movement is absent.",
            "For a justified direct remove-#23/retain-#24 plan, the retention movement test is not applicable; award appropriate sequencing for that branch without demanding a second plan.",
            "Keep any exposure or surgical route conditional; the source wording does not make a buccal-exposure route mandatory.",
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
        "title": "Anticipated outcome and reconsideration",
        "goal": "Defend the anticipated outcome of the chosen plan and state the checkpoint and new evidence that would trigger reconsideration.",
        "rubric": [
            _criterion(
                "p6-anticipated-outcome",
                "Defends an anticipated outcome by linking it to the chosen both-arch extraction and alignment plan and the patient's concerns.",
                "Defend the anticipated outcome using the selected both-arch plan, the case evidence, and the patient's crooked-teeth concern; keep the outcome conditional rather than guaranteed.",
            ),
            _criterion(
                "p6-checkpoint-reconsideration",
                "States a reassessment checkpoint relevant to the chosen plan; if retaining #23, absent movement triggers the remove-#23/retain-#24 fallback, while direct #23 extraction does not require testing its retention.",
                "Name a reassessment checkpoint for your chosen plan; for retained #23, explain the absent-movement fallback of remove-#23/retain-#24, without demanding that test after choosing direct extraction.",
            ),
            _criterion(
                "p6-evidence-tradeoffs",
                "Acknowledges the principal evidence-based trade-off or uncertainty that could change the anticipated outcome.",
                "Identify the main evidence-based trade-off or uncertainty that could change the anticipated outcome and what you would reassess.",
            ),
        ],
        "starterQuestion": "How would you defend the anticipated outcome of your chosen plan, and what checkpoint would make you reconsider it?",
        "exampleQuestions": [
            "Which case evidence most supports your anticipated outcome?",
            "How does your chosen plan address the patient's concerns and both-arch alignment?",
            "What result at the #23 movement checkpoint would make you reconsider?",
            "Which trade-off or uncertainty should remain explicit in your conclusion?",
        ],
        "tutorGuidance": [
            "Defend an anticipated outcome rather than promising a guaranteed result, and link it to the chosen plan, evidence, and patient concerns.",
            "Make the #23 movement checkpoint and reconsideration rule explicit; absent movement supports removing #23 while retaining #24.",
            "Keep optional second plans, third-molar discussion, and no-bonding #22 as bonus details rather than hidden requirements.",
            "Carry forward the supplied Phase 2 palatal #23 location with a buccally facing, unrotated crown and no recorded #22/#24 root resorption; do not confuse crown orientation or a possible exposure route with canine location.",
        ],
        "acceptedExtras": [],
        "tutorMoves": [],
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


__all__ = ["CASE1_FEEDBACK_PHASE_TEMPLATES", "build_case1_feedback_phases"]
