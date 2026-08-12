export type UserRole = "student" | "professor" | "admin";
export type Classification = "correct" | "partial" | "vague" | "wrong";
export type TutorStrategy = "probe" | "challenge" | "clarify" | "scaffold" | "reflect";
export type SessionStatus = "active" | "completed" | "abandoned";
export type ReviewStatus = "pending" | "in_review" | "completed";

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive?: boolean;
  profile?: Record<string, unknown>;
}

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
}

export interface StudentCaseOffering {
  assignment: CaseAssignment;
  teachingClass: TeachingClass;
  case: ClinicalCase;
  existingSessionId: string | null;
  availability: "upcoming" | "open" | "closed";
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
  rubric: string[];
  starterQuestion: string;
  exampleQuestions: string[];
}

export interface ClinicalCase {
  id: string;
  title: string;
  description: string;
  difficulty: "foundation" | "intermediate" | "advanced";
  status: "available" | "draft" | "archived";
  learningObjectives: string[];
  phases: CasePhase[];
  sourceCaseId?: string | null;
  version?: number;
  publishedAt?: string | null;
}

export interface TutorMessage {
  id: string;
  sessionId: string;
  sender: "student" | "ai";
  content: string;
  timestamp: string;
  replyToMessageId?: string;
}

export interface Evaluation {
  id: string;
  messageId: string;
  classification: Classification;
  confidence: number;
  reasoningGap: string;
  strategy: TutorStrategy;
  phaseComplete: boolean;
  feedback: string;
  createdAt: string;
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
  sessionReview: SessionReview | null;
  runtime: { storage: "memory" | "supabase"; tutor: "deterministic" | "claude" | "openai" };
  assignment?: CaseAssignment | null;
  teachingClass?: TeachingClass | null;
  reviewClaim?: ReviewClaim;
}

export interface MemoryPatch {
  addErrors: string[];
  addStrengths: string[];
  addWeaknesses: string[];
  masteryDelta: number;
}

export interface TutorEvaluationResult {
  classification: Classification;
  confidence: number;
  reasoningGap: string;
  strategy: TutorStrategy;
  feedback: string;
  nextQuestion: string;
  memoryPatch: MemoryPatch;
  source: "deterministic" | "claude" | "openai";
}

export const CLASSIFICATION_SCORES: Record<Classification, number> = {
  correct: 100,
  partial: 70,
  vague: 40,
  wrong: 0,
};

export function calculateScore(evaluations: Evaluation[]): number {
  if (evaluations.length === 0) return 0;
  const total = evaluations.reduce(
    (sum, evaluation) => sum + CLASSIFICATION_SCORES[evaluation.classification],
    0,
  );
  return Math.round(total / evaluations.length);
}
