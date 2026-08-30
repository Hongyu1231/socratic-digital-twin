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
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
}).refine((value) => !value.dueAt || value.dueAt > value.opensAt, {
  message: "Due date must be after the opening date.",
});

export const phaseInputSchema = z.object({
  id: z.string().uuid().optional(),
  order: z.number().int().min(1).max(12),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(500),
  rubric: z.array(z.string().trim().min(1).max(180)).min(1),
  starterQuestion: z.string().trim().min(3).max(500),
  exampleQuestions: z.array(z.string().trim().min(3).max(500)).min(1),
  tutorGuidance: z.array(z.string().trim().min(3).max(500)).max(20).default([]),
  tutorMoves: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    strategy: strategySchema,
    question: z.string().trim().min(3).max(500).refine(
      (question) => (question.match(/[?？]/g) ?? []).length === 1,
      "A scripted tutor move must contain exactly one question.",
    ),
    classifications: z.array(classificationSchema).max(4).optional(),
    answerIncludesAny: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    answerIncludesAll: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    answerOmitsAll: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    previousErrorIncludesAny: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    recordError: z.string().trim().min(1).max(180).optional(),
    blockAdvancement: z.boolean().optional(),
  }).strict()).max(20).default([]),
});

const mediaUrlSchema = z.string().trim().max(2_048).refine((value) => {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Media URLs must use HTTPS or a site-relative path.");

export const caseAttachmentInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["image", "audio", "video"]),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(500),
  url: mediaUrlSchema.optional(),
  posterUrl: mediaUrlSchema.optional(),
  transcript: z.string().trim().min(1).max(10_000).optional(),
  sourceLabel: z.string().trim().min(1).max(240).optional(),
  sourceUrl: z.string().trim().url().max(2_048).refine(
    (value) => new URL(value).protocol === "https:",
    "Source URLs must use HTTPS.",
  ).optional(),
}).superRefine((attachment, context) => {
  if ((attachment.kind === "image" || attachment.kind === "video") && !attachment.url) {
    context.addIssue({ code: "custom", path: ["url"], message: "Images and videos require a media URL." });
  }
  if (attachment.kind === "audio" && !attachment.url && !attachment.transcript) {
    context.addIssue({ code: "custom", path: ["url"], message: "Audio requires a media URL or transcript." });
  }
  if (attachment.url?.startsWith("https://")) {
    if (!attachment.sourceLabel) {
      context.addIssue({ code: "custom", path: ["sourceLabel"], message: "Externally hosted media requires a source label." });
    }
    if (!attachment.sourceUrl) {
      context.addIssue({ code: "custom", path: ["sourceUrl"], message: "Externally hosted media requires an HTTPS source URL." });
    }
  }
});

export const caseInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().min(5).max(1500),
  difficulty: z.enum(["foundation", "intermediate", "advanced"]),
  learningObjectives: z.array(z.string().trim().min(1).max(250)).min(1),
  attachments: z.array(caseAttachmentInputSchema).max(12).default([]),
  phases: z.array(phaseInputSchema).min(1).max(12),
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
  tutorReviews: z.array(
    z.object({
      evaluationId: z.string().uuid(),
      tutorMessageId: z.string().uuid(),
      naturalness: z.number().int().min(1).max(5),
      specificity: z.number().int().min(1).max(5),
      nonLeading: z.number().int().min(1).max(5),
      challengeFit: z.number().int().min(1).max(5),
      helpfulness: z.number().int().min(1).max(5),
      failureTags: z.array(z.enum([
        "generic", "repetitive", "leading", "multi_part", "too_difficult",
        "too_easy", "mini_lecture", "diagnosis_leak", "not_grounded",
      ])).max(9),
      preferredRewrite: z.string().trim().max(1_000).default(""),
      comments: z.string().trim().max(1_500).default(""),
    }),
  ).default([]),
  overallFeedback: z.string().trim().max(3_000).default(""),
  status: z.enum(["draft", "completed"]),
});

export const tutorOutputSchema = z.object({
  classification: classificationSchema,
  confidence: z.number().min(0).max(1),
  reasoningGap: z.string().min(1).max(500),
  misconceptionKey: z.string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/, "Misconception keys must be stable lowercase identifiers.")
    .nullable(),
  strategy: strategySchema,
  feedback: z.string().min(1).max(350),
  nextQuestion: z.string().min(3).max(500).refine(
    (question) => (question.match(/[?？]/g) ?? []).length === 1,
    "The tutor response must contain exactly one question.",
  ),
  memoryPatch: z.object({
    addErrors: z.array(z.string().min(1).max(180)).max(2),
    addStrengths: z.array(z.string().min(1).max(180)).max(2),
    addWeaknesses: z.array(z.string().min(1).max(180)).max(2),
    masteryDelta: z.number().min(-0.25).max(0.4),
  }).strict(),
}).strict().superRefine((result, context) => {
  if (result.classification === "wrong") {
    if (!result.misconceptionKey) {
      context.addIssue({ code: "custom", path: ["misconceptionKey"], message: "Wrong answers require a stable misconception key." });
    }
    if (!["challenge", "probe", "scaffold"].includes(result.strategy)) {
      context.addIssue({ code: "custom", path: ["strategy"], message: "Wrong answers must be challenged, probed, or scaffolded." });
    }
  } else if (result.misconceptionKey !== null) {
    context.addIssue({ code: "custom", path: ["misconceptionKey"], message: "Only wrong answers may carry a misconception key." });
  }
});

export const summaryOutputSchema = z.object({
  headline: z.string().min(1).max(120),
  narrative: z.string().min(1).max(900),
  strengths: z.array(z.string().min(1).max(180)).min(1).max(5),
  weaknesses: z.array(z.string().min(1).max(180)).max(5),
  nextSteps: z.array(z.string().min(1).max(180)).min(1).max(5),
});

export const freezeDatasetSchema = z.object({
  name: z.string().trim().min(3).max(120),
});

export const tutorCandidateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  provider: z.enum(["openai", "claude", "deterministic"]),
  model: z.string().trim().min(1).max(160),
  promptVersion: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/i),
  instructions: z.string().trim().min(100).max(12_000),
});

export const evaluationRunSchema = z.object({
  datasetId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

export const humanizationExperimentSchema = z.object({
  name: z.string().trim().min(3).max(120),
  evalRunId: z.string().uuid(),
  mode: z.enum(["shadow", "ab"]),
  trafficPercent: z.number().int().min(0).max(25).default(0),
}).refine((value) => value.mode === "ab" || value.trafficPercent === 0, {
  message: "Shadow experiments never serve candidate traffic.",
});

export const facultyApprovalSchema = z.object({
  evalRunId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().min(10).max(2_000),
});

export const tutorReleaseSchema = z.object({
  evalRunId: z.string().uuid(),
  trafficPercent: z.number().int().min(1).max(25),
  releaseNotes: z.string().trim().min(10).max(2_000),
});

export const tutorRollbackSchema = z.object({
  releaseId: z.string().uuid(),
  reason: z.string().trim().min(10).max(2_000),
});
