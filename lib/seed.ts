import type { CaseAssignment, ClinicalCase, DemoUser, TeachingClass } from "@/lib/domain";

export const DEMO_STUDENT_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_PROFESSOR_ID = "22222222-2222-4222-8222-222222222222";
export const DEMO_PROFESSOR_2_ID = "22222222-2222-4222-8222-222222222223";
export const DEMO_STUDENT_2_ID = "11111111-1111-4111-8111-111111111112";
export const DEMO_STUDENT_3_ID = "11111111-1111-4111-8111-111111111113";
export const DEMO_ADMIN_ID = "99999999-9999-4999-8999-999999999999";
export const IMPACTED_CANINE_CASE_ID = "33333333-3333-4333-8333-333333333333";
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
    "A 12-year-old patient presents with an unerupted upper right permanent canine. Clinical examination shows asymmetry in eruption timing; a panoramic radiograph is available for structured discussion.",
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
    },
    {
      id: "44444444-4444-4444-8444-444444444443",
      caseId: IMPACTED_CANINE_CASE_ID,
      order: 3,
      title: "Risk Assessment & Decision Making",
      goal: "Relate position, development and adjacent anatomy to treatment risk.",
      rubric: ["root resorption", "adjacent incisor", "space", "angulation", "age", "prognosis"],
      starterQuestion: "Which risks would change the urgency or direction of your management plan?",
      exampleQuestions: [
        "How would proximity to an incisor root alter your priorities?",
        "Which uncertainties still matter before committing to treatment?",
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
    },
    {
      id: "44444444-4444-4444-8444-444444444445",
      caseId: IMPACTED_CANINE_CASE_ID,
      order: 5,
      title: "Reflection & Synthesis",
      goal: "Make the reasoning process explicit and identify what could change the decision.",
      rubric: ["evidence", "uncertainty", "assumption", "alternative", "reassessment", "reflection"],
      starterQuestion: "Looking back, which assumption had the greatest influence on your decision?",
      exampleQuestions: [
        "What new evidence would make you revise your plan?",
        "Where were you most at risk of jumping to a conclusion?",
      ],
    },
  ],
};

export const demoCases = [impactedCanineCase];

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

export function getDemoUser(id: string) {
  return demoUsers.find((user) => user.id === id);
}
