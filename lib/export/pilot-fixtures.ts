import type { CaseAssignment, ClinicalCase, DemoUser, LearnerState, PauseInterval, PhaseTutorProgress, SessionBundle, TeachingClass, TutorMessage } from "@/lib/domain";

/** Shared test fixtures for the pilot export. Not imported by app code. */

export const CLASS_ID = "c1c1c1c1-0000-4000-8000-000000000001";
export const OTHER_CLASS_ID = "c2c2c2c2-0000-4000-8000-000000000002";
export const ASSIGNMENT_ID = "a1a1a1a1-0000-4000-8000-000000000001";
export const OTHER_ASSIGNMENT_ID = "a2a2a2a2-0000-4000-8000-000000000002";
export const PROFESSOR_ID = "p1p1p1p1-0000-4000-8000-000000000001";
export const OTHER_PROFESSOR_ID = "p2p2p2p2-0000-4000-8000-000000000002";
export const ADMIN_ID = "adadadad-0000-4000-8000-000000000001";

// Residents' only stable identifier is the hidden code email. Display names
// are deliberately real-looking: the export must never use them.
export const SECRET_EMAILS = ["r03@pilot.invalid", "r10@pilot.invalid", "r02@pilot.invalid", "prof.private@nus.edu.sg", "r99@pilot.invalid"];
export const SECRET_NAMES = ["Alicia Tan", "Prof. Marcus Lim", "Benjamin Lee", "Chloe Wong", "Daniel Goh"];

export const users: Record<string, DemoUser> = {
  r03: { id: "u0300000-0000-4000-8000-000000000003", name: SECRET_NAMES[0]!, email: SECRET_EMAILS[0]!, role: "student", profile: { fullName: SECRET_NAMES[0] } },
  r10: { id: "u1000000-0000-4000-8000-000000000010", name: SECRET_NAMES[2]!, email: SECRET_EMAILS[1]!, role: "student" },
  r02: { id: "u0200000-0000-4000-8000-000000000002", name: SECRET_NAMES[3]!, email: SECRET_EMAILS[2]!, role: "student" },
  prof: { id: PROFESSOR_ID, name: SECRET_NAMES[1]!, email: SECRET_EMAILS[3]!, role: "professor" },
  r99: { id: "u9900000-0000-4000-8000-000000000099", name: SECRET_NAMES[4]!, email: SECRET_EMAILS[4]!, role: "student" },
};

export const PHASE_TITLES = [
  "Problem Identification", "Clinical & Radiographic Assessment", "Assess the prognosis",
  "Risk Assessment & Decision Making", "Management", "Reflection on the plan",
];

export const clinicalCase: ClinicalCase = {
  id: "case-1", title: "Impacted Maxillary Canine", description: "A 12-year-old patient.", difficulty: "intermediate",
  status: "available", learningObjectives: [],
  phases: PHASE_TITLES.map((title, index) => ({
    id: `phase-${index + 1}`, caseId: "case-1", order: index + 1, title, goal: "Goal", rubric: ["a"],
    starterQuestion: `Question for phase ${index + 1}?`, exampleQuestions: [],
  })),
};

export const teachingClass: TeachingClass = {
  id: CLASS_ID, name: "Case 1 Resident Pilot", code: "CASE-1-PILOT", term: "2026", status: "active",
  createdBy: ADMIN_ID, createdAt: "2026-10-01T00:00:00.000Z",
  members: [
    { classId: CLASS_ID, userId: users.r10!.id, role: "student", isLead: false, user: users.r10 },
    { classId: CLASS_ID, userId: users.r03!.id, role: "student", isLead: false, user: users.r03 },
    { classId: CLASS_ID, userId: users.r02!.id, role: "student", isLead: false, user: users.r02 },
    { classId: CLASS_ID, userId: PROFESSOR_ID, role: "professor", isLead: true, user: users.prof },
  ],
};

export const otherClass: TeachingClass = {
  ...teachingClass, id: OTHER_CLASS_ID, name: "Other", code: "OTHER",
  members: [
    { classId: OTHER_CLASS_ID, userId: users.r99!.id, role: "student", isLead: false, user: users.r99 },
    { classId: OTHER_CLASS_ID, userId: users.r03!.id, role: "student", isLead: false, user: users.r03 },
    { classId: OTHER_CLASS_ID, userId: OTHER_PROFESSOR_ID, role: "professor", isLead: true },
  ],
};

export const assignments: CaseAssignment[] = [
  { id: ASSIGNMENT_ID, classId: CLASS_ID, caseId: "case-1", assignedBy: PROFESSOR_ID, status: "open", opensAt: "2026-10-01T00:00:00.000Z", dueAt: null, createdAt: "2026-10-01T00:00:00.000Z" },
  { id: OTHER_ASSIGNMENT_ID, classId: OTHER_CLASS_ID, caseId: "case-1", assignedBy: OTHER_PROFESSOR_ID, status: "open", opensAt: "2026-10-01T00:00:00.000Z", dueAt: null, createdAt: "2026-10-01T00:00:00.000Z" },
];

const done = (withSupport = false): PhaseTutorProgress => ({
  criteriaMet: ["a"], bestClassification: "correct", noProgressCount: 0, supportLevel: withSupport ? 2 : 0,
  awaitingApplication: false, completedWithSupport: withSupport, completed: true,
});

function state(sessionId: string, progress: Record<string, PhaseTutorProgress>): LearnerState {
  return {
    sessionId, currentGoal: "", previousErrors: [], strengths: [], weaknesses: [], nextStrategy: "probe",
    phaseAttempts: {}, mastery: {}, phaseProgress: progress, version: 1, updatedAt: "2026-11-02T00:00:00.000Z",
  };
}

let messageCounter = 0;
export function message(sessionId: string, sender: "ai" | "student", content: string, timestamp: string, extra: Partial<TutorMessage> = {}): TutorMessage {
  messageCounter += 1;
  return { id: `${sessionId}-m${messageCounter}`, sessionId, sender, content, timestamp, ...extra };
}

interface SessionOptions {
  id: string;
  student: DemoUser;
  assignmentId: string;
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  completedAt?: string | null;
  pausedAt?: string | null;
  pauseHistory?: PauseInterval[];
  completedAllPhases?: boolean;
  score?: number | null;
  progress?: Record<string, PhaseTutorProgress>;
  messages?: TutorMessage[];
}

export function bundle(options: SessionOptions): SessionBundle {
  return {
    session: {
      id: options.id, studentId: options.student.id, caseId: clinicalCase.id, currentPhase: 1,
      status: options.status, reviewStatus: "pending", score: options.score ?? null,
      summary: options.completedAllPhases === undefined ? null : {
        overallScore: options.score ?? 0, headline: "", narrative: "", strengths: [], weaknesses: [], nextSteps: [],
        completedAllPhases: options.completedAllPhases,
      },
      createdAt: options.createdAt, completedAt: options.completedAt ?? null, pausedAt: options.pausedAt ?? null,
      ...(options.pauseHistory ? { pauseHistory: options.pauseHistory } : {}),
      assignmentId: options.assignmentId, messages: options.messages ?? [], evaluations: [],
      state: state(options.id, options.progress ?? {}),
    },
    case: clinicalCase, student: options.student, answerReviews: [], tutorTurnReviews: [], sessionReview: null,
    runtime: { storage: "memory", tutor: "deterministic" }, summaryGenerationStatus: "ready",
  };
}

const allDone = (supported: number[] = []) => Object.fromEntries(PHASE_TITLES.map((_, index) => [String(index + 1), done(supported.includes(index + 1))]));

export const LONG_ANSWER = `${"The canine is palatally displaced. ".repeat(1200)}END-OF-LONG-ANSWER`;

/** A mix of every case the export has to handle. */
export function fixtureSessions(): SessionBundle[] {
  const s1 = "s1000000-0000-4000-8000-000000000001";
  const s2 = "s2000000-0000-4000-8000-000000000002";
  const s3 = "s3000000-0000-4000-8000-000000000003";
  return [
    // R10 ended early after phase 1.
    bundle({
      id: s3, student: users.r10!, assignmentId: ASSIGNMENT_ID, status: "completed",
      createdAt: "2026-11-02T02:00:00.000Z", completedAt: "2026-11-02T02:20:00.000Z", completedAllPhases: false, score: 55,
      pauseHistory: [{ pausedAt: "2026-11-02T02:10:00.000Z", resumedAt: "2026-11-02T02:13:00.000Z" }],
      progress: { "1": done() },
      messages: [
        message(s3, "ai", "Question for phase 1?", "2026-11-02T02:00:00.000Z", { phaseOrder: 1 }),
        message(s3, "student", "The canine is missing.", "2026-11-02T02:05:00.000Z", { phaseOrder: 1, turnKind: "answer" }),
        message(s3, "ai", "Question for phase 2?", "2026-11-02T02:06:00.000Z", { phaseOrder: 2 }),
      ],
    }),
    // R03 second attempt, still going and paused right now.
    bundle({
      id: s2, student: users.r03!, assignmentId: ASSIGNMENT_ID, status: "active",
      createdAt: "2026-11-03T01:00:00.000Z", pausedAt: "2026-11-03T01:30:00.000Z",
      pauseHistory: [{ pausedAt: "2026-11-03T01:30:00.000Z" }],
      progress: { "1": done() },
      messages: [
        message(s2, "ai", "Question for phase 1?", "2026-11-03T01:00:00.000Z", { phaseOrder: 1 }),
        message(s2, "student", "Still thinking about it.", "2026-11-03T01:25:00.000Z", { phaseOrder: 1, turnKind: "answer" }),
      ],
    }),
    // R03 first attempt, completed, needed help in phase 2, one long answer.
    bundle({
      id: s1, student: users.r03!, assignmentId: ASSIGNMENT_ID, status: "completed",
      createdAt: "2026-11-02T01:00:00.000Z", completedAt: "2026-11-02T02:05:00.000Z", completedAllPhases: true, score: 82,
      pauseHistory: [
        { pausedAt: "2026-11-02T01:20:00.000Z", resumedAt: "2026-11-02T01:30:00.000Z" },
        { pausedAt: "2026-11-02T01:40:00.000Z", resumedAt: "2026-11-02T01:45:00.000Z" },
      ],
      progress: allDone([2]),
      messages: [
        message(s1, "ai", "Question for phase 1?", "2026-11-02T01:00:00.000Z", { phaseOrder: 1 }),
        message(s1, "student", LONG_ANSWER, "2026-11-02T01:03:00.000Z", { phaseOrder: 1, turnKind: "answer" }),
        // Stored with the old phase number, as the app does; it opens phase 2.
        message(s1, "ai", "Good. Question for phase 2?", "2026-11-02T01:04:00.000Z", { phaseOrder: 1, moveType: "transition" }),
        message(s1, "student", "Requested more help", "2026-11-02T01:10:00.000Z", { phaseOrder: 2, turnKind: "help", helpRequested: true }),
        message(s1, "ai", "Consider the radiograph.", "2026-11-02T01:10:01.000Z", { phaseOrder: 2, turnKind: "help", helpRequested: true }),
        message(s1, "student", "Sector 3 overlap.", "2026-11-02T01:12:00.000Z", { phaseOrder: 2, turnKind: "answer" }),
        message(s1, "ai", "Well done, that covers every phase.", "2026-11-02T02:05:00.000Z"),
      ],
    }),
    // R02 walked away; recorded as abandoned.
    bundle({
      id: "s4000000-0000-4000-8000-000000000004", student: users.r02!, assignmentId: ASSIGNMENT_ID, status: "abandoned",
      createdAt: "2026-11-04T01:00:00.000Z",
    }),
    // Professor test run on the same assignment: must be excluded.
    bundle({ id: "s5000000-0000-4000-8000-000000000005", student: users.prof!, assignmentId: ASSIGNMENT_ID, status: "completed", createdAt: "2026-11-02T00:00:00.000Z", completedAt: "2026-11-02T00:30:00.000Z", completedAllPhases: true }),
    // Another class's resident and R03's session in that other class: excluded.
    bundle({ id: "s6000000-0000-4000-8000-000000000006", student: users.r99!, assignmentId: OTHER_ASSIGNMENT_ID, status: "active", createdAt: "2026-11-02T00:00:00.000Z" }),
    bundle({ id: "s7000000-0000-4000-8000-000000000007", student: users.r03!, assignmentId: OTHER_ASSIGNMENT_ID, status: "active", createdAt: "2026-11-01T00:00:00.000Z" }),
  ];
}

export const EXPORTED_AT = new Date("2026-11-05T16:30:00.000Z"); // 06 Nov 2026 00:30 in Singapore
