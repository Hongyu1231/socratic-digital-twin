import type { CaseAssignment, ClinicalCase, DemoUser, TeachingClass } from "@/lib/domain";

export const DEMO_STUDENT_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_PROFESSOR_ID = "22222222-2222-4222-8222-222222222222";
export const DEMO_PROFESSOR_2_ID = "22222222-2222-4222-8222-222222222223";
export const DEMO_STUDENT_2_ID = "11111111-1111-4111-8111-111111111112";
export const DEMO_STUDENT_3_ID = "11111111-1111-4111-8111-111111111113";
export const DEMO_ADMIN_ID = "99999999-9999-4999-8999-999999999999";
export const IMPACTED_CANINE_CASE_ID = "33333333-3333-4333-8333-333333333333";
export const ACUTE_TOOTH_PAIN_CASE_ID = "33333333-3333-4333-8333-333333333334";
export const PERIODONTAL_RISK_CASE_ID = "33333333-3333-4333-8333-333333333335";
export const FRACTURED_INCISOR_CASE_ID = "33333333-3333-4333-8333-333333333336";
export const IMPACTED_SECOND_MOLAR_CASE_ID = "33333333-3333-4333-8333-333333333337";
export const DEMO_CLASS_ID = "55555555-5555-4555-8555-555555555555";
export const DEMO_ASSIGNMENT_ID = "66666666-6666-4666-8666-666666666666";

export const demoUsers: DemoUser[] = [
  {
    id: DEMO_STUDENT_ID,
    name: "Alicia Tan",
    email: "alicia.tan@u.nus.edu",
    role: "student",
    isActive: true,
  },
  {
    id: DEMO_PROFESSOR_ID,
    name: "Prof. Marcus Lim",
    email: "marcus.lim@nus.edu.sg",
    role: "professor",
    isActive: true,
  },
  { id: DEMO_STUDENT_2_ID, name: "Benjamin Lee", email: "benjamin.lee@u.nus.edu", role: "student", isActive: true },
  { id: DEMO_STUDENT_3_ID, name: "Chloe Wong", email: "chloe.wong@u.nus.edu", role: "student", isActive: true },
  { id: DEMO_PROFESSOR_2_ID, name: "Prof. Sarah Ng", email: "sarah.ng@nus.edu.sg", role: "professor", isActive: true },
  { id: DEMO_ADMIN_ID, name: "Dr. Elaine Koh", email: "elaine.koh@nus.edu.sg", role: "admin", isActive: true },
];

export const impactedCanineCase: ClinicalCase = {
  id: IMPACTED_CANINE_CASE_ID,
  title: "Impacted Maxillary Canine",
  description:
    "A 12-year-old patient is referred by a general dental practitioner because the upper right permanent canine has not erupted. The primary canine on that side remains present. The patient has a Class I molar relationship with mild upper-arch crowding, and a panoramic radiograph is available.",
  difficulty: "intermediate",
  status: "available",
  sourceCaseId: null,
  version: 1,
  publishedAt: "2026-08-09T00:00:00.000Z",
  learningObjectives: [
    "Identify clinically significant signs of delayed eruption",
    "Select and interpret appropriate radiographic investigations",
    "Reason about canine position and adjacent structures",
    "Compare interceptive and definitive management options",
    "Reflect on uncertainty and decision quality",
  ],
  phases: [
    {
      id: "44444444-4444-4444-8444-444444444441",
      caseId: IMPACTED_CANINE_CASE_ID,
      order: 1,
      title: "Problem Identification",
      goal: "Identify the central clinical concern without jumping to a definitive diagnosis.",
      rubric: ["unerupted or delayed eruption", "eruption asymmetry", "possible impaction", "age or eruption timing"],
      starterQuestion: "What concerns you most about this presentation, and why?",
      exampleQuestions: [
        "What makes delayed eruption clinically significant in this patient?",
        "Which finding supports impaction rather than normal variation?",
      ],
      tutorGuidance: ["Withhold the diagnosis, distinguish observation from clinical significance, and use a spatial cue before naming adjacent-root harm."],
    },
    {
      id: "44444444-4444-4444-8444-444444444442",
      caseId: IMPACTED_CANINE_CASE_ID,
      order: 2,
      title: "Clinical & Radiographic Assessment",
      goal: "Build a proportionate assessment strategy before escalating imaging.",
      rubric: ["clinical palpation", "panoramic radiograph", "parallax", "position", "CBCT justification"],
      starterQuestion: "How would you investigate the position of the canine step by step?",
      exampleQuestions: [
        "What could palpation tell you before requesting further imaging?",
        "Why might CBCT not always be the first investigation?",
      ],
      tutorGuidance: ["Challenge premature advanced imaging, begin with clinical examination, and deliberately return to an earlier CBCT jump after first-line imaging has been discussed."],
      tutorMoves: [
        {
          id: "canine-premature-cbct",
          strategy: "challenge",
          question: "Before requesting any imaging, what could you learn from examining the patient?",
          classifications: ["correct", "partial", "vague", "wrong"],
          answerIncludesAny: ["cbct"],
          answerOmitsAll: ["clinical", "palpation", "palpate", "opg", "panoramic", "parallax"],
          recordError: "Premature CBCT escalation before clinical examination and first-line imaging",
          blockAdvancement: true,
        },
        {
          id: "canine-revisit-cbct",
          strategy: "probe",
          question: "You mentioned CBCT earlier. What remaining uncertainty would justify it after clinical examination and first-line imaging?",
          classifications: ["correct"],
          previousErrorIncludesAny: ["premature cbct"],
          blockAdvancement: true,
        },
      ],
    },
    {
      id: "44444444-4444-4444-8444-444444444443",
      caseId: IMPACTED_CANINE_CASE_ID,
      order: 3,
      title: "Risk Assessment & Decision Making",
      goal: "Relate position, development and adjacent anatomy to treatment risk.",
      rubric: ["root resorption", "adjacent incisor", "space", "angulation", "patient age and root development", "prognosis"],
      starterQuestion: "Which risks would change the urgency or direction of your management plan?",
      exampleQuestions: [
        "How would proximity to an incisor root alter your priorities?",
        "Which uncertainties still matter before committing to treatment?",
      ],
      tutorGuidance: ["An OPG cannot establish bucco-palatal position. Expose that assumption, then force a patient-specific commitment after weighing age, root development, space, angulation and adjacent-root risk."],
      tutorMoves: [
        {
          id: "canine-opg-palatal-assumption",
          strategy: "challenge",
          question: "How do you know the canine is palatally displaced from an OPG alone?",
          classifications: ["correct", "partial", "vague", "wrong"],
          answerIncludesAny: ["palatal", "palatally"],
          answerOmitsAll: ["parallax", "cbct", "tube shift", "cannot tell", "can't tell", "cannot show", "can't show", "does not show", "doesn't show", "2d", "two-dimensional"],
          recordError: "Inferred a bucco-palatal position from a two-dimensional OPG",
          blockAdvancement: true,
        },
        {
          id: "canine-management-commitment",
          strategy: "challenge",
          question: "For this patient, would you observe after primary-canine extraction or create orthodontic space at the same time, and why?",
          classifications: ["correct"],
          blockAdvancement: true,
        },
      ],
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      caseId: IMPACTED_CANINE_CASE_ID,
      order: 4,
      title: "Management",
      goal: "Compare management options and justify a patient-specific choice.",
      rubric: ["interceptive extraction", "space creation", "surgical exposure", "orthodontic traction", "monitoring"],
      starterQuestion: "What management options would you consider, and what would make you choose among them?",
      exampleQuestions: [
        "What assumptions must be true for interceptive treatment to succeed?",
        "When would observation no longer be a defensible option?",
      ],
      tutorGuidance: ["Require the direction of traction and anchorage consequences, not only the procedure name. If the crown overlaps the lateral root, cue the learner to move it away before bringing it into the arch."],
      tutorMoves: [
        {
          id: "canine-unsafe-traction-vector",
          strategy: "challenge",
          question: "Where is the canine crown relative to the lateral incisor root before you pull it down?",
          classifications: ["correct", "partial", "vague", "wrong"],
          answerIncludesAny: ["down into the arch", "straight down", "pull it down", "vertically into the arch"],
          answerOmitsAll: ["distal", "away from", "clear the root"],
          recordError: "Proposed pulling the canine across the lateral incisor root",
          blockAdvancement: true,
        },
      ],
    },
    {
      id: "44444444-4444-4444-8444-444444444445",
      caseId: IMPACTED_CANINE_CASE_ID,
      order: 5,
      title: "Reflection & Synthesis",
      goal: "Make the reasoning process explicit and identify what could change the decision.",
      rubric: ["evidence", "uncertainty", "assumption", "alternative", "reassessment", "reflection"],
      starterQuestion: "Why not extract the impacted canine and place an implant later?",
      exampleQuestions: [
        "What new evidence would make you revise your plan?",
        "Where were you most at risk of jumping to a conclusion?",
      ],
      tutorGuidance: ["Begin with a plausible alternative viewpoint, then end with a metacognitive question about the highest-leverage decision point."],
      tutorMoves: [
        {
          id: "canine-metacognitive-closure",
          strategy: "reflect",
          question: "Looking back at the whole case, where was the highest-leverage decision point, and what should a general dentist know?",
          classifications: ["correct"],
          blockAdvancement: true,
        },
      ],
    },
  ],
};

export const impactedSecondMolarCase: ClinicalCase = {
  id: IMPACTED_SECOND_MOLAR_CASE_ID,
  title: "Impacted Mandibular Second Molar",
  description: "A 14-year-old patient is referred because the mandibular right second molar has not erupted. The first molars and premolars are fully erupted; the patient has a Class I molar relationship, a well-aligned upper arch, and mild lower-arch crowding. A panoramic radiograph shows about 40 degrees of mesial inclination, the crown contacting the distal surface of the first molar, three-quarters root formation, and a developing third-molar bud distally.",
  difficulty: "advanced",
  status: "available",
  sourceCaseId: null,
  version: 1,
  publishedAt: "2026-08-18T00:00:00.000Z",
  learningObjectives: [
    "Distinguish delayed eruption from impaction",
    "Assess spontaneous eruption potential using multiple variables",
    "Plan space around the developing third molar",
    "Specify force systems and anchorage",
    "Coordinate surgical access with orthodontic mechanics",
    "Defend and reflect on a patient-specific decision",
  ],
  phases: [
    {
      id: "44444444-4444-4444-8444-444444444481",
      caseId: IMPACTED_SECOND_MOLAR_CASE_ID,
      order: 1,
      title: "Problem Identification",
      goal: "Distinguish a delayed second molar from an impacted tooth and explain why the distinction matters.",
      rubric: ["eruption timing and normal variation", "mesial angulation", "diagnostic criteria", "risk to the first molar", "pericoronal pathology"],
      starterQuestion: "What stands out to you in this case?",
      exampleQuestions: ["What would need to be true for you to call this impacted rather than delayed?"],
      tutorGuidance: ["Challenge premature diagnostic labels and use spatial cues to explore consequences for the adjacent first molar."],
      tutorMoves: [{
        id: "molar-premature-diagnosis",
        strategy: "challenge",
        question: "What would need to be true for you to call it impacted rather than delayed?",
        classifications: ["correct", "partial", "vague", "wrong"],
        answerIncludesAny: ["impacted", "impaction"],
        answerOmitsAll: ["age", "eruption", "angulation", "root development"],
        recordError: "Called the second molar impacted before establishing diagnostic criteria",
        blockAdvancement: true,
      }],
    },
    {
      id: "44444444-4444-4444-8444-444444444482",
      caseId: IMPACTED_SECOND_MOLAR_CASE_ID,
      order: 2,
      title: "Assessing Eruption Potential",
      goal: "Judge observation versus intervention by integrating eruption potential rather than relying on one variable.",
      rubric: ["angulation severity", "root development", "patient age", "available space", "spontaneous correction", "observation threshold"],
      starterQuestion: "Does this tooth need treatment now, or could it still erupt on its own?",
      exampleQuestions: ["What if the angulation were 15 degrees rather than 40 degrees?"],
      tutorGuidance: ["Use a 15-degree hypothetical to expose single-variable reasoning and compare age, root development and space before forcing a decision."],
      tutorMoves: [{
        id: "molar-single-variable-angulation",
        strategy: "challenge",
        question: "What if the angulation were 15 degrees rather than 40 degrees; how would your decision change?",
        classifications: ["correct", "partial", "vague", "wrong"],
        answerIncludesAny: ["40 degrees", "40-degree", "angulation", "angle"],
        answerOmitsAll: ["age", "root", "space"],
        recordError: "Based the intervention decision on angulation alone",
        blockAdvancement: true,
      }],
    },
    {
      id: "44444444-4444-4444-8444-444444444483",
      caseId: IMPACTED_SECOND_MOLAR_CASE_ID,
      order: 3,
      title: "Space Assessment and Treatment Planning",
      goal: "Assess the space required for uprighting and account for the developing third molar.",
      rubric: ["space distal to the first molar", "third molar position", "distal uprighting path", "irreversible trade-off", "consent"],
      starterQuestion: "Before uprighting, what must be true about the space distal to the first molar?",
      exampleQuestions: ["What is sitting directly behind the second molar?"],
      tutorGuidance: ["If the third molar is omitted, use the spatial cue from the script rather than naming it."],
      tutorMoves: [{
        id: "molar-third-molar-omission",
        strategy: "scaffold",
        question: "Looking at the radiograph, what is sitting directly behind the second molar?",
        classifications: ["correct", "partial", "vague", "wrong"],
        answerOmitsAll: ["third molar", "third-molar", "wisdom tooth"],
        recordError: "Omitted the developing third molar from the space assessment",
        blockAdvancement: true,
      }],
    },
    {
      id: "44444444-4444-4444-8444-444444444484",
      caseId: IMPACTED_SECOND_MOLAR_CASE_ID,
      order: 4,
      title: "Biomechanics",
      goal: "Specify a safe uprighting force system, its moment and anchorage consequences.",
      rubric: ["distally directed crown force", "moment and tipping", "centre of resistance", "reactive mesial force", "anchorage reinforcement", "direct or indirect anchorage"],
      starterQuestion: "Describe the force system you would use to upright the second molar.",
      exampleQuestions: ["What force and moment do you need, and what controls the reaction?"],
      tutorGuidance: ["Ask for force, moment and anchorage specificity. Allow visible mid-sentence self-correction before intervening."],
      tutorMoves: [{
        id: "molar-vague-biomechanics",
        strategy: "clarify",
        question: "When you say upright it, what force, moment and anchorage control do you need?",
        classifications: ["correct", "partial", "vague", "wrong"],
        answerIncludesAny: ["upright", "spring", "elastic", "tip"],
        answerOmitsAll: ["force", "moment", "anchorage"],
        recordError: "Described uprighting without specifying force, moment or anchorage",
        blockAdvancement: true,
      }],
    },
    {
      id: "44444444-4444-4444-8444-444444444485",
      caseId: IMPACTED_SECOND_MOLAR_CASE_ID,
      order: 5,
      title: "Surgical Considerations",
      goal: "Determine whether surgical access is required and communicate the mechanical requirements to the surgeon.",
      rubric: ["crown accessibility", "surgical exposure", "conservative bone removal", "attachment placement", "force direction", "flap design"],
      starterQuestion: "Can you always bond an attachment to the second molar and start treatment?",
      exampleQuestions: ["Can you see the crown in the patient's mouth?"],
      tutorGuidance: ["Expose a false assumption about access with a spatial question; do not announce the need for surgery."],
      tutorMoves: [{
        id: "molar-false-access-assumption",
        strategy: "challenge",
        question: "The crown is tipped under the distal surface of the first molar; can you see it in the patient's mouth?",
        classifications: ["correct", "partial", "vague", "wrong"],
        answerIncludesAny: ["bond", "attachment", "bracket", "button"],
        answerOmitsAll: ["surgical", "exposure", "flap", "bone"],
        recordError: "Assumed the second-molar crown was accessible for bonding",
        blockAdvancement: true,
      }],
    },
    {
      id: "44444444-4444-4444-8444-444444444486",
      caseId: IMPACTED_SECOND_MOLAR_CASE_ID,
      order: 6,
      title: "Reflection and Synthesis",
      goal: "Evaluate a plausible extraction alternative and identify the most consequential decision point.",
      rubric: ["second-molar prognosis", "third-molar position and development", "patient age", "eruption potential", "alternative viewpoint", "consequential decision point", "cross-case principle"],
      starterQuestion: "Why not extract the impacted second molar and let the third molar drift forward?",
      exampleQuestions: ["Are there situations where that alternative might be reasonable?"],
      tutorGuidance: ["Push back on blanket dismissal of the extraction alternative, then close with a highest-leverage reflection and cross-case integration."],
      tutorMoves: [
        {
          id: "molar-nuance-alternative",
          strategy: "challenge",
          question: "In what situation might extracting the second molar and relying on the third molar be reasonable?",
          classifications: ["partial", "vague", "wrong"],
          answerIncludesAny: ["no guarantee", "would not extract", "wouldn't extract", "too risky", "gambling"],
        },
        {
          id: "molar-metacognitive-closure",
          strategy: "reflect",
          question: "Across the whole case, where was the single most consequential decision point, and why?",
          classifications: ["correct"],
          blockAdvancement: true,
        },
      ],
    },
  ],
};

type DemoPhaseSeed = [title: string, goal: string, rubric: string[], starterQuestion: string, followUp: string];

function buildDemoCase(id: string, title: string, description: string, objectives: string[], phases: DemoPhaseSeed[]): ClinicalCase {
  return {
    id,
    title,
    description,
    difficulty: "intermediate",
    status: "available",
    sourceCaseId: null,
    version: 1,
    publishedAt: "2026-08-13T00:00:00.000Z",
    learningObjectives: objectives,
    phases: phases.map(([phaseTitle, goal, rubric, starterQuestion, followUp], index) => ({
      id: `44444444-4444-4444-8444-4444444444${String(({ [ACUTE_TOOTH_PAIN_CASE_ID]: 5, [PERIODONTAL_RISK_CASE_ID]: 6, [FRACTURED_INCISOR_CASE_ID]: 7 } as Record<string, number>)[id])}${index + 1}`,
      caseId: id,
      order: index + 1,
      title: phaseTitle,
      goal,
      rubric,
      starterQuestion,
      exampleQuestions: [followUp],
    })),
  };
}

export const acuteToothPainCase = buildDemoCase(
  ACUTE_TOOTH_PAIN_CASE_ID,
  "Acute Posterior Tooth Pain",
  "A 29-year-old simulated patient reports spontaneous throbbing pain from a lower posterior tooth that lingers after cold drinks and disturbed sleep last night.",
  ["Interpret a structured pain history", "Plan focused diagnostic tests", "Integrate pulpal and apical findings", "Use proportionate treatment and antibiotic stewardship", "Safety-net and reflect"],
  [
    ["Pain Pattern & Urgency", "Build a concise problem representation and screen for urgent spread or systemic involvement.", ["onset", "duration", "provocation", "spontaneous pain", "sleep disturbance", "swelling", "systemic features"], "Which details in this pain history are most diagnostically useful, and what urgent features must you still exclude?", "How would duration, provocation, spontaneity, and sleep disturbance change your concern?"],
    ["Focused Clinical Testing", "Design a sequenced clinical and radiographic assessment using comparison teeth.", ["visual examination", "control tooth", "sensibility tests", "percussion", "palpation", "probing", "radiograph"], "Which examination and diagnostic tests would you perform, in what order, and what would each result tell you?", "Why should sensibility findings be interpreted with percussion, probing, and radiographic information?"],
    ["Diagnostic Integration", "Integrate the evidence into separate defensible pulpal and apical working diagnoses.", ["pulpal diagnosis", "apical diagnosis", "differentials", "supporting evidence", "uncertainty"], "How would you combine the history and test results into a pulpal and an apical working diagnosis?", "Which conflicting result would make you reconsider the leading explanation?"],
    ["Immediate Management", "Propose proportionate immediate and definitive management with antibiotic stewardship.", ["source control", "definitive care", "analgesia", "restorability", "consent", "antibiotic stewardship"], "What immediate care would address the source of pain, and how would you plan definitive treatment?", "When would systemic antibiotics become appropriate, and why are they not routine for toothache alone?"],
    ["Safety Net & Reflection", "Communicate uncertainty, review timing, escalation triggers, and evidence that could change the plan.", ["teach-back", "review interval", "red flags", "escalation", "reflection"], "How would you explain the plan, safety-net the patient, and arrange review?", "Which assumption in your reasoning is most vulnerable to new evidence?"],
  ],
);

export const periodontalRiskCase = buildDemoCase(
  PERIODONTAL_RISK_CASE_ID,
  "Periodontal Risk and Bone Loss",
  "A 35-year-old simulated patient reports bleeding during brushing, persistent bad breath, and recent movement of a lower incisor. The history includes daily tobacco use.",
  ["Build a periodontal problem representation", "Collect complete periodontal data", "Justify classification and prognosis", "Plan cause-related therapy", "Re-evaluate and maintain"],
  [
    ["Problem Representation & Risk", "Summarize the periodontal concern and identify risk factors without premature staging.", ["bleeding", "mobility", "tobacco exposure", "medical risk", "extent"], "How would you summarize the central periodontal concern, and which risk factors matter most?", "What additional history would distinguish local disease from a generalized pattern?"],
    ["Periodontal Data Collection", "Plan an assessment that determines extent, severity, complexity, and activity.", ["six-point chart", "attachment level", "bleeding on probing", "plaque", "mobility", "furcation", "bone loss"], "Which measurements and examinations are required before you can characterize this condition?", "How would you use probing, attachment levels, mobility, plaque, bleeding, and radiographs together?"],
    ["Classification & Prognosis", "Justify diagnosis, extent, stage, grade, and tooth-level prognosis from evidence.", ["diagnosis", "extent", "stage", "grade", "risk modifiers", "prognosis"], "How would you justify the extent, stage, and grade rather than simply naming them?", "Which finding has the greatest influence on prognosis, and what uncertainty remains?"],
    ["Cause-related Management", "Design phased initial care addressing biofilm, risk factors, and local contributors.", ["oral hygiene", "risk control", "non-surgical therapy", "local factors", "shared goals"], "What would your initial treatment phase include, and how would you prioritize it?", "How would you support tobacco cessation and agree on outcomes that matter to this patient?"],
    ["Re-evaluation & Maintenance", "Define response measures, escalation criteria, and individualized supportive care.", ["reevaluation timing", "probing response", "bleeding response", "residual pockets", "escalation", "maintenance interval"], "When and how would you re-evaluate the response to initial therapy?", "Which residual findings would change the next phase or maintenance interval?"],
  ],
);

export const fracturedIncisorCase = buildDemoCase(
  FRACTURED_INCISOR_CASE_ID,
  "Fractured Immature Maxillary Incisor",
  "A 9-year-old simulated patient presents two hours after a playground fall with a fractured upper central incisor, a small visible pulp exposure, and an incompletely developed root.",
  ["Triage dental trauma safely", "Assess associated injuries", "Connect root maturity to biological goals", "Compare vital-pulp options", "Plan long-term follow-up"],
  [
    ["Trauma History & Triage", "Prioritize general trauma safety, timing, contamination, and prognostic factors.", ["general injury", "loss of consciousness", "injury time", "contamination", "tetanus", "root maturity"], "What must you establish first in the history and triage before focusing on the fractured tooth?", "How do injury timing and root maturity influence the urgency of preserving pulp vitality?"],
    ["Clinical & Radiographic Assessment", "Detect associated luxation, root, alveolar, and soft-tissue injuries.", ["soft tissues", "fragment search", "mobility", "displacement", "percussion", "occlusion", "radiographs", "adjacent teeth"], "How would you examine this child and tooth while minimizing additional discomfort?", "Which associated injuries must be excluded clinically and radiographically?"],
    ["Injury Classification & Biological Goals", "Classify the injury and explain the importance of continued root development.", ["injury classification", "pulp exposure", "vitality", "apexogenesis", "prognostic factors"], "How would you classify the injury, and what is the main biological treatment goal?", "Which findings would make vital pulp therapy less predictable?"],
    ["Vital Pulp Management", "Compare conservative options and justify a plan that preserves tissue and seals the tooth.", ["partial pulpotomy", "asepsis", "haemostasis", "biocompatible material", "coronal seal", "consent"], "Which management option best protects continued root development, and how would you perform it?", "How would exposure size, contamination, haemostasis, restorability, and cooperation alter your choice?"],
    ["Follow-up & Reflection", "Monitor healing, vitality, root development, restoration integrity, and complications.", ["symptoms", "clinical signs", "pulp response", "root development", "periapical health", "restoration", "safety net"], "What would you monitor at review, and which changes would require intervention?", "How would you explain uncertainty and long-term follow-up to the child and caregiver?"],
  ],
);

export const demoCases = [impactedCanineCase, impactedSecondMolarCase, acuteToothPainCase, periodontalRiskCase, fracturedIncisorCase];

export const demoClass: TeachingClass = {
  id: DEMO_CLASS_ID,
  name: "Orthodontic Clinical Reasoning",
  code: "ORT-P01",
  term: "AY2026/27 Semester 1",
  status: "active",
  createdBy: DEMO_ADMIN_ID,
  createdAt: "2026-08-09T00:00:00.000Z",
  members: [
    { classId: DEMO_CLASS_ID, userId: DEMO_PROFESSOR_ID, role: "professor", isLead: true },
    { classId: DEMO_CLASS_ID, userId: DEMO_PROFESSOR_2_ID, role: "professor", isLead: false },
    { classId: DEMO_CLASS_ID, userId: DEMO_STUDENT_ID, role: "student", isLead: false },
    { classId: DEMO_CLASS_ID, userId: DEMO_STUDENT_2_ID, role: "student", isLead: false },
    { classId: DEMO_CLASS_ID, userId: DEMO_STUDENT_3_ID, role: "student", isLead: false },
  ],
};

export const demoAssignment: CaseAssignment = {
  id: DEMO_ASSIGNMENT_ID,
  classId: DEMO_CLASS_ID,
  caseId: IMPACTED_CANINE_CASE_ID,
  assignedBy: DEMO_PROFESSOR_ID,
  status: "open",
  opensAt: "2026-08-09T00:00:00.000Z",
  dueAt: null,
  createdAt: "2026-08-09T00:00:00.000Z",
  className: demoClass.name,
  caseTitle: impactedCanineCase.title,
};

export const demoAssignments: CaseAssignment[] = [
  demoAssignment,
  ...[
    ["66666666-6666-4666-8666-666666666667", acuteToothPainCase],
    ["66666666-6666-4666-8666-666666666668", periodontalRiskCase],
    ["66666666-6666-4666-8666-666666666669", fracturedIncisorCase],
    ["66666666-6666-4666-8666-666666666670", impactedSecondMolarCase],
  ].map(([id, clinicalCase]) => ({
    id: id as string,
    classId: DEMO_CLASS_ID,
    caseId: (clinicalCase as ClinicalCase).id,
    assignedBy: DEMO_PROFESSOR_ID,
    status: "open" as const,
    opensAt: "2026-08-13T00:00:00.000Z",
    dueAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    className: demoClass.name,
    caseTitle: (clinicalCase as ClinicalCase).title,
  })),
];

export function getDemoUser(id: string) {
  return demoUsers.find((user) => user.id === id);
}
