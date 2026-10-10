import { z } from "zod";
import { CRITERION_EVIDENCE_MAX_LENGTH } from "@/lib/domain";
import {
  CASE_DESCRIPTION_MAX_LENGTH,
  CASE_TITLE_MAX_LENGTH,
  MEDIA_URL_MAX_LENGTH,
} from "@/lib/case-limits.mjs";

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
  /** Ordinary answer text is required unless this is an explicit Help press. */
  message: z.string().trim().min(2).max(2_000).optional(),
  clientRequestId: z.string().trim().min(8).max(100).optional(),
  helpRequested: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.helpRequested === true) {
    if (!value.clientRequestId) {
      context.addIssue({ code: "custom", path: ["clientRequestId"], message: "Help requests require a client request ID." });
    }
    // Presence, rather than truthiness, matters here: an empty message is a
    // mixed answer+Help payload and must not be silently treated as Help.
    if (value.message !== undefined) {
      context.addIssue({ code: "custom", path: ["message"], message: "Help requests must not include a message." });
    }
    return;
  }
  if (value.message === undefined) {
    context.addIssue({ code: "custom", path: ["message"], message: "Submit an answer or request help." });
  }
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
  idempotencyKey: z.string().trim().min(1).max(160).nullable().optional(),
}).refine((value) => !value.dueAt || Date.parse(value.dueAt) > Date.parse(value.opensAt), {
  message: "Due date must be after the opening date.",
});

export const rubricCriterionSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  text: z.string().trim().min(1).max(500),
  revealText: z.string().trim().min(1).max(500).optional(),
}).strict();

/**
 * A model-awarded criterion and the short answer quote retained for review.
 * Evidence is intentionally recorded, not verified against the answer.
 */
export const criterionEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(100),
  evidence: z.string().trim().min(1).max(CRITERION_EVIDENCE_MAX_LENGTH),
}).strict();

/**
 * Existing stored/provider adapters may still emit the historical string-only
 * form. The provider schema below is deliberately stricter and only accepts
 * structured evidence for new model calls.
 */
export const criteriaMetSchema = z.union([
  z.array(criterionEvidenceSchema).max(32),
  z.array(z.string().trim().min(1).max(100)).max(32),
]);

export const phaseInputSchema = z.object({
  id: z.string().uuid().optional(),
  order: z.number().int().min(1).max(12),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(500),
  rubric: z.array(z.union([z.string().trim().min(1).max(180), rubricCriterionSchema])).min(1).max(32),
  acceptedExtras: z.array(rubricCriterionSchema.omit({ revealText: true })).max(32).default([]),
  noProgressLimit: z.number().int().min(1).max(4).optional(),
  phaseCeiling: z.number().int().min(2).max(12).optional(),
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
    targetCriterionId: z.string().trim().min(1).max(100).optional(),
  }).strict()).max(20).default([]),
}).superRefine((phase, context) => {
  const ids = phase.rubric.map((item, index) => typeof item === "string" ? `r${index + 1}` : item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["rubric"], message: "Criterion IDs must be unique within a phase." });
  const extraIds = phase.acceptedExtras.map((extra) => extra.id);
  if (new Set(extraIds).size !== extraIds.length || extraIds.some((id) => ids.includes(id))) {
    context.addIssue({ code: "custom", path: ["acceptedExtras"], message: "Accepted-extra IDs must be unique and must not overlap required criteria." });
  }
  phase.tutorMoves.forEach((move, index) => {
    if (move.targetCriterionId && !ids.includes(move.targetCriterionId)) {
      context.addIssue({ code: "custom", path: ["tutorMoves", index, "targetCriterionId"], message: "A scripted move must target a criterion in this phase." });
    }
  });
});

const mediaUrlSchema = z.string().trim().max(MEDIA_URL_MAX_LENGTH).refine((value) => {
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
  title: z.string().trim().min(1).max(CASE_TITLE_MAX_LENGTH),
  description: z.string().trim().min(1).max(CASE_DESCRIPTION_MAX_LENGTH),
  url: mediaUrlSchema.optional(),
  posterUrl: mediaUrlSchema.optional(),
  transcript: z.string().trim().min(1).max(10_000).optional(),
  sourceLabel: z.string().trim().min(1).max(240).optional(),
  storagePath: z.string().trim().min(1).max(512).refine(
    (value) => value.split("/").length >= 2 && value.split("/").every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(part)),
    "Storage paths must contain safe object-key segments.",
  ).optional(),
  unlockPhase: z.number().int().min(1).max(12).optional(),
  unlockOnRequest: z.literal(false).optional(),
  sourceUrl: z.string().trim().url().max(MEDIA_URL_MAX_LENGTH).refine(
    (value) => new URL(value).protocol === "https:",
    "Source URLs must use HTTPS.",
  ).optional(),
}).superRefine((attachment, context) => {
  if (attachment.storagePath && (attachment.url || attachment.posterUrl)) {
    context.addIssue({ code: "custom", path: ["storagePath"], message: "Private media must not also store public media URLs." });
  }
  if ((attachment.kind === "image" || attachment.kind === "video") && !attachment.url && !attachment.storagePath) {
    context.addIssue({ code: "custom", path: ["url"], message: "Images and videos require a media URL." });
  }
  if (attachment.kind === "audio" && !attachment.url && !attachment.storagePath && !attachment.transcript) {
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
  title: z.string().trim().min(2).max(CASE_TITLE_MAX_LENGTH),
  description: z.string().trim().min(5).max(CASE_DESCRIPTION_MAX_LENGTH),
  difficulty: z.enum(["foundation", "intermediate", "advanced"]),
  learningObjectives: z.array(z.string().trim().min(1).max(250)).min(1),
  attachments: z.array(caseAttachmentInputSchema).max(12).default([]),
  findings: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(1500),
    unlockPhase: z.number().int().min(1).max(12).default(1),
    unlockOnRequest: z.literal(false).optional(),
  }).strict()).max(40).default([]),
  correctionProbes: z.union([z.literal(1), z.literal(2)]).optional(),
  phases: z.array(phaseInputSchema).min(1).max(12),
}).superRefine((clinicalCase, context) => {
  const phaseOrders = new Set(clinicalCase.phases.map((phase) => phase.order));
  const phaseIds = clinicalCase.phases.flatMap((phase) => phase.id ? [phase.id] : []);
  if (new Set(phaseIds).size !== phaseIds.length) {
    context.addIssue({ code: "custom", path: ["phases"], message: "Phase IDs must be unique." });
  }
  if (phaseOrders.size !== clinicalCase.phases.length
    || clinicalCase.phases.some((phase, index) => phase.order !== index + 1)) {
    context.addIssue({ code: "custom", path: ["phases"], message: "Phases must be ordered consecutively from 1." });
  }
  if (new Set(clinicalCase.findings.map((item) => item.id)).size !== clinicalCase.findings.length) {
    context.addIssue({ code: "custom", path: ["findings"], message: "Finding IDs must be unique." });
  }
  for (const key of ["attachments", "findings"] as const) {
    clinicalCase[key].forEach((item, index) => {
      if (!phaseOrders.has(item.unlockPhase ?? 1)) context.addIssue({ code: "custom", path: [key, index, "unlockPhase"], message: "Unlock phase must exist in this case." });
    });
  }
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
  // Optional in the application parser for old adapters. Providers use the
  // explicit nullable wire contract below; semantic annotation errors are
  // sanitized independently from the grading result.
  acknowledgement: z.string().nullable().optional(),
  targetCriterionId: z.string().nullable().optional(),
  answerCriterionId: z.string().nullable().optional(),
  criteriaMet: criteriaMetSchema.optional(),
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

export const tutorProviderOutputSchema = tutorOutputSchema.safeExtend({
  acknowledgement: z.string().nullable(),
  targetCriterionId: z.string().nullable(),
  answerCriterionId: z.string().nullable(),
  criteriaMet: z.array(criterionEvidenceSchema).max(32),
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
