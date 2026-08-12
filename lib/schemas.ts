import { z } from "zod";

export const classificationSchema = z.enum(["correct", "partial", "vague", "wrong"]);
export const strategySchema = z.enum(["probe", "challenge", "clarify", "scaffold", "reflect"]);

export const startSessionSchema = z.object({
  assignmentId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
}).refine((value) => value.assignmentId || value.caseId, {
  message: "Select a valid case assignment.",
});

export const sessionMessageSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().trim().min(2).max(2_000),
  clientRequestId: z.string().trim().min(8).max(100).optional(),
});

export const identitySwitchSchema = z.object({
  userId: z.string().uuid().optional(),
  role: z.enum(["student", "professor", "admin"]).optional(),
}).refine((value) => value.userId || value.role, {
  message: "Select a valid demo identity.",
});

export const userUpdateSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
});

export const classInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(30),
  term: z.string().trim().min(2).max(50),
  status: z.enum(["active", "archived"]).default("active"),
});

export const classMembersSchema = z.object({
  studentIds: z.array(z.string().uuid()),
  professorIds: z.array(z.string().uuid()),
  leadProfessorId: z.string().uuid(),
}).refine((value) => value.professorIds.includes(value.leadProfessorId), {
  message: "The lead professor must be a class professor.",
});

export const assignmentInputSchema = z.object({
  id: z.string().uuid().optional(),
  classId: z.string().uuid(),
  caseId: z.string().uuid(),
  status: z.enum(["draft", "open", "closed"]).default("open"),
  // PostgreSQL returns timestamptz values with an explicit +00:00 offset while
  // browser-created values normally use Z. Accept both ISO-8601 forms so a
  // previously persisted assignment can be closed or reopened.
  opensAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
}).refine((value) => !value.dueAt || value.dueAt > value.opensAt, {
  message: "Due date must be after the opening date.",
});

export const phaseInputSchema = z.object({
  id: z.string().uuid().optional(),
  order: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(500),
  rubric: z.array(z.string().trim().min(1).max(180)).min(1),
  starterQuestion: z.string().trim().min(3).max(500),
  exampleQuestions: z.array(z.string().trim().min(3).max(500)).min(1),
});

export const caseInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().min(5).max(1500),
  difficulty: z.enum(["foundation", "intermediate", "advanced"]),
  learningObjectives: z.array(z.string().trim().min(1).max(250)).min(1),
  phases: z.array(phaseInputSchema).length(5),
});

export const reviewReassignSchema = z.object({
  sessionId: z.string().uuid(),
  professorId: z.string().uuid().nullable(),
});

export const professorReviewSchema = z.object({
  sessionId: z.string().uuid(),
  reviews: z.array(
    z.object({
      evaluationId: z.string().uuid(),
      label: classificationSchema,
      comments: z.string().trim().max(1_500).default(""),
    }),
  ),
  overallFeedback: z.string().trim().max(3_000).default(""),
  status: z.enum(["draft", "completed"]),
});

export const tutorOutputSchema = z.object({
  classification: classificationSchema,
  confidence: z.number().min(0).max(1),
  reasoningGap: z.string().min(1).max(500),
  strategy: strategySchema,
  feedback: z.string().min(1).max(350),
  nextQuestion: z.string().min(3).max(500),
  memoryPatch: z.object({
    addErrors: z.array(z.string().min(1).max(180)).max(2),
    addStrengths: z.array(z.string().min(1).max(180)).max(2),
    addWeaknesses: z.array(z.string().min(1).max(180)).max(2),
    masteryDelta: z.number().min(-0.25).max(0.4),
  }).strict(),
}).strict();

export const summaryOutputSchema = z.object({
  headline: z.string().min(1).max(120),
  narrative: z.string().min(1).max(900),
  strengths: z.array(z.string().min(1).max(180)).max(5),
  weaknesses: z.array(z.string().min(1).max(180)).max(5),
  nextSteps: z.array(z.string().min(1).max(180)).min(1).max(5),
});
