export type UserRole = "student" | "professor" | "admin";
export type Classification = "correct" | "partial" | "vague" | "wrong";
export type TutorStrategy = "probe" | "challenge" | "clarify" | "scaffold" | "reflect";
export type SessionStatus = "active" | "completed" | "abandoned";
export type ReviewStatus = "pending" | "in_review" | "completed";
export type SummaryGenerationStatus = "pending" | "ready" | "failed";

/**
 * Evidence attached to a criterion awarded by the tutor model.
 *
 * The quote is retained for professor review. It is deliberately not
 * verified against the answer: paraphrase is valid evidence and rejecting it
 * would turn a model annotation problem into a blocked learner turn.
 */
export interface CriterionEvidence {
  id: string;
  evidence: string;
}

/** Stored evaluations may contain the pre-v2 string-only representation. */
export type CriteriaMet = CriterionEvidence[] | string[];

/** Provider output and persisted evidence use the same bounded quote limit. */
export const CRITERION_EVIDENCE_MAX_LENGTH = 240;

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive?: boolean;
  profile?: Record<string, unknown>;
}

/** The deliberately minimal identity shape exposed by the public demo API. */
export type PublicDemoIdentity = Pick<DemoUser, "id" | "name" | "role">;

export type ClassStatus = "active" | "archived";
export type AssignmentStatus = "draft" | "open" | "closed";

export interface ClassMembership {
  classId: string;
  userId: string;
  role: "student" | "professor";
  isLead: boolean;
  user?: DemoUser;
}

export interface TeachingClass {
  id: string;
  name: string;
  code: string;
  term: string;
  status: ClassStatus;
  createdBy: string;
  createdAt: string;
  members: ClassMembership[];
}

export interface CaseAssignment {
  id: string;
  classId: string;
  caseId: string;
  assignedBy: string;
  status: AssignmentStatus;
  opensAt: string;
  dueAt: string | null;
  createdAt: string;
  className?: string;
  caseTitle?: string;
  idempotencyKey?: string | null;
}

export interface StudentCaseOffering {
  assignment: CaseAssignment;
  teachingClass: TeachingClass;
  case: ClinicalCase;
  existingSessionId: string | null;
  existingSessionStatus?: SessionStatus | null;
  existingSessionPausedAt?: string | null;
  availability: "upcoming" | "open" | "closed";
}

export type CaseAttachmentKind = "image" | "audio" | "video";

export interface CaseAttachment {
  id: string;
  kind: CaseAttachmentKind;
  title: string;
  description: string;
  url?: string;
  posterUrl?: string;
  transcript?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  /** Server-only object key in the private case-media bucket. Never a signed URL. */
  storagePath?: string;
  unlockPhase?: number;
  unlockOnRequest?: false;
  /** Derived response metadata, never persisted as a media reference. */
  expiresAt?: string;
}

export interface ClinicalFinding {
  id: string;
  title: string;
  text: string;
  unlockPhase: number;
  unlockOnRequest?: false;
}

export interface RubricCriterion {
  id: string;
  text: string;
  revealText?: string;
}

export interface CaseVersionSummary {
  id: string;
  sourceCaseId: string | null;
  version: number;
  title: string;
  status: ClinicalCase["status"] | "archived";
  publishedAt: string | null;
}

export interface AdminOverview {
  userCount: number;
  classCount: number;
  openAssignmentCount: number;
  sessionCount: number;
  pendingReviewCount: number;
  completionRate: number;
  unclaimedReviewCount: number;
}

export type StaffReviewFilter = "all" | "available" | "mine" | "claimed" | "completed";

export interface StaffSessionCursor {
  createdAt: string;
  id: string;
}

export interface StaffSessionQuery {
  limit?: number;
  /** Opaque cursor returned by StaffSessionPage.nextCursor. */
  cursor?: string | null;
  classId?: string;
  reviewFilter?: StaffReviewFilter;
}

export interface StaffSessionSummary {
  session: Pick<LearningSession, "id" | "caseId" | "studentId" | "assignmentId" | "status" | "reviewStatus" | "score" | "createdAt" | "completedAt" | "reviewerId">;
  case: Pick<ClinicalCase, "id" | "title"> & { version?: number };
  student: Pick<DemoUser, "id" | "name">;
  assignment: Pick<CaseAssignment, "id" | "classId"> | null;
  teachingClass: Pick<TeachingClass, "id" | "name"> | null;
  reviewClaim: NonNullable<SessionBundle["reviewClaim"]>;
}

export interface StaffSessionStats {
  total: number;
  completed: number;
  reviewed: number;
  available: number;
  mine: number;
  claimed: number;
}

export interface StaffAssignmentProgress {
  sessionCount: number;
  completedCount: number;
}

export interface StaffSessionPage {
  sessions: StaffSessionSummary[];
  nextCursor: string | null;
  stats: StaffSessionStats;
  assignmentProgress: Record<string, StaffAssignmentProgress>;
}

export interface ReviewClaim {
  reviewerId: string | null;
  reviewerName: string | null;
  state: "unclaimed" | "mine" | "other" | "completed";
  canEdit: boolean;
}

export interface CasePhase {
  id: string;
  caseId: string;
  order: number;
  title: string;
  goal: string;
  rubric: Array<string | RubricCriterion>;
  acceptedExtras?: Array<{ id: string; text: string }>;
  starterQuestion: string;
  exampleQuestions: string[];
  tutorGuidance?: string[];
  tutorMoves?: TutorMove[];
  noProgressLimit?: number;
  phaseCeiling?: number;
  /** Student projection only: never IDs or grading text. */
  phaseProgress?: { criteriaMet: number; criteriaTotal: number; completedWithSupport: boolean };
}

export interface TutorMove {
  id: string;
  strategy: TutorStrategy;
  question: string;
  classifications?: Classification[];
  answerIncludesAny?: string[];
  answerIncludesAll?: string[];
  answerOmitsAll?: string[];
  previousErrorIncludesAny?: string[];
  recordError?: string;
  blockAdvancement?: boolean;
  targetCriterionId?: string;
}

export interface ClinicalCase {
  id: string;
  title: string;
  description: string;
  difficulty: "foundation" | "intermediate" | "advanced";
  status: "available" | "draft" | "archived" | "superseded";
  learningObjectives: string[];
  phases: CasePhase[];
  sourceCaseId?: string | null;
  version?: number;
  publishedAt?: string | null;
  attachments?: CaseAttachment[];
  findings?: ClinicalFinding[];
  correctionProbes?: 1 | 2;
  isTestFixture?: boolean;
  /** Server-only pointer to a validated hosted teaching-material package. */
  teachingMaterialPackageId?: string;
}

export interface TutorMessage {
  id: string;
  sessionId: string;
  sender: "student" | "ai";
  content: string;
  timestamp: string;
  replyToMessageId?: string;
  acknowledgement?: string;
  moveType?: "question" | "hypothetical" | "reveal" | "correction" | "transition" | "reflection";
}

export interface Evaluation {
  id: string;
  messageId: string;
  classification: Classification;
  confidence: number;
  reasoningGap: string;
  /** Stable rubric/misconception identifier used to distinguish repeated errors. */
  misconceptionKey?: string | null;
  strategy: TutorStrategy;
  phaseComplete: boolean;
  feedback: string;
  phaseOrder?: number;
  attempt?: number;
  provider?: "deterministic" | "claude" | "openai";
  fallbackFrom?: "claude" | "openai";
  model?: string;
  promptVersion?: string;
  targetCriterionId?: string;
  /** Required criterion meaningfully addressed by the current answer. */
  answerCriterionId?: string | null;
  criteriaMet?: CriteriaMet;
  supportLevel?: 0 | 1 | 2;
  completedWithSupport?: boolean;
  isReflection?: boolean;
  retrieval?: { query: string; passages: Array<{ sourceId: string; page: number; locator?: string; score: number }> };
  createdAt: string;
}

export interface PhaseTutorProgress {
  criteriaMet: string[];
  bestClassification: Classification;
  noProgressCount: number;
  supportLevel: 0 | 1 | 2;
  awaitingApplication: boolean;
  completedWithSupport: boolean;
  completed: boolean;
}

export interface PhaseLearnerEvidence {
  strengths: string[];
  weaknesses: string[];
  previousErrors: string[];
  completed: boolean;
}

export interface LearnerState {
  sessionId: string;
  currentGoal: string;
  previousErrors: string[];
  strengths: string[];
  weaknesses: string[];
  nextStrategy: TutorStrategy;
  phaseAttempts: Record<string, number>;
  mastery: Record<string, number>;
  usedTutorMoves?: string[];
  /** Persisted in session_state.state JSON; legacy sessions may not have provenance. */
  phaseEvidence?: Record<string, PhaseLearnerEvidence>;
  phaseProgress?: Record<string, PhaseTutorProgress>;
  reflectionAsked?: boolean;
  reflectionAnswered?: boolean;
  version: number;
  updatedAt: string;
}

export interface SessionSummary {
  overallScore: number;
  headline: string;
  narrative: string;
  strengths: string[];
  weaknesses: string[];
  nextSteps: string[];
  completedAllPhases: boolean;
  supportedPhases?: number[];
}

export interface LearningSession {
  id: string;
  studentId: string;
  caseId: string;
  currentPhase: number;
  status: SessionStatus;
  reviewStatus: ReviewStatus;
  score: number | null;
  summary: SessionSummary | null;
  createdAt: string;
  completedAt: string | null;
  pausedAt?: string | null;
  assignmentId?: string | null;
  reviewerId?: string | null;
  messages: TutorMessage[];
  evaluations: Evaluation[];
  state: LearnerState;
}

export interface AnswerReview {
  evaluationId: string;
  professorId: string;
  label: Classification;
  comments: string;
  updatedAt: string;
}

export type TutorQualityFailureTag =
  | "generic"
  | "repetitive"
  | "leading"
  | "multi_part"
  | "too_difficult"
  | "too_easy"
  | "mini_lecture"
  | "diagnosis_leak"
  | "not_grounded";

export interface TutorTurnReview {
  evaluationId: string;
  tutorMessageId: string;
  professorId: string;
  naturalness: number;
  specificity: number;
  nonLeading: number;
  challengeFit: number;
  helpfulness: number;
  failureTags: TutorQualityFailureTag[];
  preferredRewrite: string;
  comments: string;
  updatedAt: string;
}

export interface SessionReview {
  sessionId: string;
  professorId: string;
  overallFeedback: string;
  status: "draft" | "completed";
  finalScore: number | null;
  updatedAt: string;
}

export interface SessionBundle {
  session: LearningSession;
  case: ClinicalCase;
  student: DemoUser;
  answerReviews: AnswerReview[];
  tutorTurnReviews: TutorTurnReview[];
  sessionReview: SessionReview | null;
  runtime: {
    storage: "memory" | "supabase";
    tutor: "deterministic" | "claude" | "openai";
    fallbackFrom?: "claude" | "openai";
  };
  assignment?: CaseAssignment | null;
  teachingClass?: TeachingClass | null;
  reviewClaim?: ReviewClaim;
  summaryGenerationStatus: SummaryGenerationStatus;
}

export interface MemoryPatch {
  addErrors: string[];
  addStrengths: string[];
  addWeaknesses: string[];
  masteryDelta: number;
}

export interface TutorEvaluateInput {
  phase: CasePhase;
  caseContext?: {
    title: string;
    description: string;
    learningObjectives: string[];
    attachments: Array<Pick<CaseAttachment, "kind" | "title" | "description" | "transcript">>;
    findings?: ClinicalFinding[];
    /** Server-only reference data. Never part of ClinicalCase or student API responses. */
    teachingContext?: {
      expertNotes: string;
      sourceDocument: string;
      literature: Array<{ sourceId: string; title: string; page: number; text: string;
        sourceType?: "published_literature" | "expert_interview"; locator?: string; expert?: string; section?: string }>;
    };
  };
  answer: string;
  state: LearnerState;
  attempt: number;
  currentQuestion?: string;
  recentDialogue?: Array<{ sender: "student" | "ai"; content: string }>;
  recentEvaluations?: Array<Pick<Evaluation, "classification" | "misconceptionKey" | "reasoningGap" | "phaseOrder">>;
  /** Set only on the second, step-up call: the level just reached and the criterion to write about. */
  support?: { level: 1 | 2; targetCriterion: RubricCriterion };
}

export interface TutorEvaluationResult {
  classification: Classification;
  confidence: number;
  reasoningGap: string;
  /** Null unless the classification is wrong. Reuse the key while the same misconception persists. */
  misconceptionKey: string | null;
  strategy: TutorStrategy;
  feedback: string;
  nextQuestion: string;
  acknowledgement?: string;
  targetCriterionId?: string | null;
  /** Required criterion meaningfully addressed by the current answer. */
  answerCriterionId?: string | null;
  criteriaMet?: CriteriaMet;
  memoryPatch: MemoryPatch;
  source: "deterministic" | "claude" | "openai";
  fallbackFrom?: "claude" | "openai";
}

export const CLASSIFICATION_SCORES: Record<Classification, number> = {
  correct: 100,
  partial: 70,
  vague: 40,
  wrong: 0,
};

export function calculateScore(evaluations: Evaluation[]): number {
  const graded = evaluations.filter((evaluation) => !evaluation.isReflection);
  if (graded.length === 0) return 0;
  const total = graded.reduce(
    (sum, evaluation) => sum + CLASSIFICATION_SCORES[evaluation.classification],
    0,
  );
  return Math.round(total / graded.length);
}
