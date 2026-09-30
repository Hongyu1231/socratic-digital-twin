"""Conservative, machine-readable clinical-content draft for local review.

This module intentionally contains teaching prompts, not patient findings.  It
is used by the private materials importer to make the application-authored
scaffold explicit and reviewable.  Nothing here is clinical approval and the
generated material must not be promoted until a clinician has reviewed it
against the source case records and the case-scoped expert material.
"""

from copy import deepcopy
import hashlib
import json


DRAFT_REVIEW_STATUS = "DRAFT_REQUIRES_CLINICIAN_APPROVAL"
DRAFT_REVIEWER = "Jessica Hoe"

REVIEW_CHECKLIST = [
    "Confirm every criterion against the source case introduction and supplied records.",
    "Confirm that observation, interpretation, association and causation remain distinct.",
    "Confirm each revealText asks the learner to apply evidence without disclosing a hidden diagnosis or unshown image finding.",
    "Review case-scoped expert-interview passages as attributed opinions, not universal rules or a substitute for the case record.",
    "Keep the imported cases in draft until explicit clinician approval is recorded.",
]

# These are deliberately evidence-limited prompts.  They do not assert what a
# particular OPG shows, which tooth is affected, or whether any root is
# resorbed.  Stable IDs make later authoring and persisted evidence auditable.
PHASE_TEMPLATES = [
    {
        "title": "Record and initial assessment",
        "goal": "Describe what the supplied record establishes, then identify relevant history or examination information needed for an initial assessment.",
        "rubric": [
            {
                "id": "p1-record-observation",
                "text": "Names one observable finding and its tooth or region from the supplied record.",
                "revealText": "State one observable finding and identify its tooth or region; do not infer a cause the record does not establish.",
            },
            {
                "id": "p1-history-exam-context",
                "text": "Identifies relevant history or examination information needed to interpret the supplied record and explains why it matters to the initial assessment.",
                "revealText": "Name a relevant history or examination detail and explain why it matters to the initial assessment; do not infer a cause the record does not establish.",
            },
        ],
        "starterQuestion": "What relevant history or clinical-examination information would you gather before interpreting the record?",
        "exampleQuestions": [
            "Which supplied record supports the observation, and what exactly does it show?",
            "Which history or examination detail would change your initial assessment, and why?",
        ],
        "tutorGuidance": [
            "Keep observations, interpretations and causes separate; a recorded finding is not automatically causal.",
            "Ask for relevant history and examination details before asking for a clinical explanation.",
            "Do not volunteer a diagnosis or an image finding that the learner has not established from the supplied record.",
        ],
    },
    {
        "title": "Localise the canine",
        "goal": "Reason about the possible position of the canine using the supplied records and state what remains uncertain.",
        "rubric": [
            {
                "id": "p2-record-localisation",
                "text": "Uses an identified supplied record to describe the canine position or relationship being assessed.",
                "revealText": "Name the supplied record that supports the positional observation and state the relationship it can establish.",
            },
            {
                "id": "p2-imaging-limitation",
                "text": "Separates a two-dimensional observation from an unverified three-dimensional conclusion.",
                "revealText": "State what remains uncertain with the available projection before proposing additional imaging.",
            },
        ],
        "starterQuestion": "What can the available records establish about the canine position, and what remains uncertain?",
        "exampleQuestions": [
            "Which supplied record best supports your positional observation?",
            "What limitation of the available projection should shape your next investigation?",
        ],
        "tutorGuidance": [
            "Ask the learner to identify the record before accepting a positional conclusion.",
            "Do not convert overlap or a projection into an unshown bucco-palatal finding.",
            "Use expert opinions to frame trade-offs, not to invent an absent image result.",
        ],
    },
    {
        "title": "Assess adjacent-structure risk",
        "goal": "Prioritise adjacent structures and patient-specific risk while distinguishing a possible complication from a confirmed finding.",
        "rubric": [
            {
                "id": "p3-adjacent-risk",
                "text": "Identifies the adjacent structure or complication that should be assessed from the supplied evidence.",
                "revealText": "Name the adjacent structure or complication to assess and identify the supplied evidence that makes it relevant.",
            },
            {
                "id": "p3-risk-uncertainty",
                "text": "States what would distinguish a possible risk from established damage or a management-changing finding.",
                "revealText": "State the uncertainty that must be resolved before treating a possible risk as an established finding.",
            },
        ],
        "starterQuestion": "Which adjacent structure or risk deserves the closest assessment, and why?",
        "exampleQuestions": [
            "Which supplied finding supports the risk you identified?",
            "What evidence would distinguish a possible risk from established damage?",
        ],
        "tutorGuidance": [
            "Do not state that root resorption or other damage is present unless the supplied record establishes it.",
            "Keep risk, evidence and urgency separate when comparing expert viewpoints.",
            "Ask which uncertainty would change the learner's next decision.",
        ],
    },
    {
        "title": "Build the problem list",
        "goal": "Integrate the supplied dental, occlusal and soft-tissue observations into a prioritised problem list with explicit uncertainty.",
        "rubric": [
            {
                "id": "p4-problem-list",
                "text": "Organises more than one supplied observation into a clinically prioritised problem list.",
                "revealText": "List the supplied observations that belong in the problem list and state which one should be addressed first.",
            },
            {
                "id": "p4-unresolved-uncertainty",
                "text": "Names an unresolved discrepancy or uncertainty rather than presenting an assumption as a record fact.",
                "revealText": "Identify one unresolved uncertainty and explain how it limits the current problem list.",
            },
        ],
        "starterQuestion": "How would you organise a problem list from the records you have reviewed?",
        "exampleQuestions": [
            "Which observation has the largest effect on your problem list?",
            "Which part of the problem list still depends on an unverified assumption?",
        ],
        "tutorGuidance": [
            "Require a record-linked observation before accepting a problem-list item.",
            "Do not allow a literature case or expert preference to become a fact about this patient.",
            "Preserve uncertainty where the supplied records do not resolve it.",
        ],
    },
    {
        "title": "Compare management options",
        "goal": "Compare management options using patient factors, supplied evidence and clearly stated limitations.",
        "rubric": [
            {
                "id": "p5-option-tradeoffs",
                "text": "Compares at least two management options using case-relevant benefits, risks or trade-offs.",
                "revealText": "Name the competing options and compare the trade-off that matters most for this case.",
            },
            {
                "id": "p5-patient-factors",
                "text": "Links the preferred option to patient factors and identifies what evidence could change that preference.",
                "revealText": "State which patient factor or unresolved finding would change your preferred option.",
            },
        ],
        "starterQuestion": "Which management options would you compare, and what would make you choose among them?",
        "exampleQuestions": [
            "Which patient-specific factor most changes your preferred option?",
            "What limitation in the available evidence could change your choice?",
        ],
        "tutorGuidance": [
            "Treat published case reports and expert interviews as bounded sources, not universal treatment rules.",
            "Require the learner to name the uncertainty resolved by each proposed investigation or intervention.",
            "Do not present a management answer before the learner has compared the trade-offs.",
        ],
    },
    {
        "title": "Reflect and review",
        "goal": "Defend a provisional plan and identify the decision most sensitive to uncertainty or new evidence.",
        "rubric": [
            {
                "id": "p6-plan-evidence",
                "text": "Justifies a provisional plan using the most relevant supplied case evidence.",
                "revealText": "Name the supplied evidence that carries the most weight in your provisional plan.",
            },
            {
                "id": "p6-reassessment",
                "text": "Identifies a key assumption or uncertainty and explains what new evidence would change the plan.",
                "revealText": "State the assumption or uncertainty that could change the plan and the evidence you would seek.",
            },
        ],
        "starterQuestion": "Which finding or uncertainty had the greatest influence on your provisional plan?",
        "exampleQuestions": [
            "What evidence would make you reconsider your plan?",
            "Where were you most at risk of jumping to a conclusion?",
        ],
        "tutorGuidance": [
            "End with a metacognitive reflection, not a hidden diagnosis or a model answer.",
            "Keep the learner's conclusion provisional when the supplied record remains incomplete.",
            "Preserve disagreement between attributed expert viewpoints.",
        ],
    },
]


def build_draft_phases(case_id, id_factory):
    """Return fresh, stable-ID phases for an application-authored draft."""
    phases = []
    for order, template in enumerate(PHASE_TEMPLATES, 1):
        phase = deepcopy(template)
        phase.update({
            "id": id_factory(f"{case_id}:phase:{order}"),
            "caseId": case_id,
            "order": order,
            "tutorMoves": [],
        })
        phases.append(phase)
    return phases


def build_draft_review(package_id, cases):
    """Return a sidecar review record with no source clinical text."""
    return {
        "status": DRAFT_REVIEW_STATUS,
        "approval": {
            "status": "pending",
            "reviewer": DRAFT_REVIEWER,
            "approvedAt": None,
        },
        "reviewer": DRAFT_REVIEWER,
        "packageId": package_id,
        "sourceBasis": [
            "Case-specific DOCX student introduction and supplied teaching records",
            "Case-scoped expert-interview excerpts, retained as attributed opinions",
        ],
        "checklist": list(REVIEW_CHECKLIST),
        "cases": [
            {
                "caseId": item["caseId"],
                "sourceDocument": item["sourceDocument"],
                "phaseCount": item["phaseCount"],
                "criterionIds": item["criterionIds"],
            }
            for item in cases
        ],
    }


def clinical_content_sha256(cases):
    """Hash raw manifest cases without lifecycle or approval metadata.

    The publisher can reproduce this hash with the same canonical JSON rules.
    It deliberately excludes the ``clinicalReview`` object itself so approval
    cannot become self-referential.  The raw case entries include the clinical
    scaffold, private expert notes and source filename.  Any phase, rubric,
    source-note or attachment change therefore invalidates an old approval;
    package media hashes remain independently validated by the publisher.
    """
    canonical = json.dumps(
        cases,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def build_clinical_review(cases):
    """Return the immutable-in-manifest, still-pending review gate."""
    return {
        "status": "pending",
        "reviewer": None,
        "approvedAt": None,
        "contentSha256": clinical_content_sha256(cases),
    }
