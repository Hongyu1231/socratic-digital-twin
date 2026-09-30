import type {
  AdminOverview,
  AnswerReview,
  CaseAssignment,
  ClassMembership,
  ClinicalCase,
  DemoUser,
  Evaluation,
  LearnerState,
  LearningSession,
  SessionBundle,
  SessionReview,
  SessionSummary,
  StudentCaseOffering,
  TeachingClass,
  TutorMessage,
  TutorTurnReview,
} from "@/lib/domain";
import type { CaseAttachmentDiagnostic } from "@/lib/repository/case-attachments";

/** Error raised when a student attempts to start a session on an archived case. */
export class ArchivedCaseError extends Error {
  readonly code = "ARCHIVED_CASE" as const;

  constructor(message = "This case is archived and cannot be started.") {
    super(message);
    this.name = "ArchivedCaseError";
  }
}

/** A superseded version cannot be started directly, but remains readable. */
export class SupersededCaseError extends Error {
  readonly code = "SUPERSEDED_CASE" as const;

  constructor(message = "This case version has been superseded and cannot be started directly.") {
    super(message);
    this.name = "SupersededCaseError";
  }
}

/** Raised when a client reuses a turn request id with different answer text. */
export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;

  constructor(message = "This client request ID was already used with different content.") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export interface CommitTurnInput {
  sessionId: string;
  expectedVersion: number;
  /** Stable client-generated key used to make retries return the original turn. */
  clientRequestId?: string;
  studentMessage: TutorMessage;
  evaluation: Evaluation;
  aiMessage: TutorMessage;
  nextState: LearnerState;
  nextPhase: number;
  status: LearningSession["status"];
  score: number | null;
  summary: SessionSummary | null;
  completedAt: string | null;
}

export interface SaveReviewInput {
  sessionId: string;
  professorId: string;
  reviews: Array<Pick<AnswerReview, "evaluationId" | "label" | "comments">>;
  tutorReviews?: Array<Pick<TutorTurnReview, "evaluationId" | "tutorMessageId" | "naturalness" | "specificity" | "nonLeading" | "challengeFit" | "helpfulness" | "failureTags" | "preferredRewrite" | "comments">>;
  overallFeedback: string;
  status: SessionReview["status"];
}

export interface TutorRepository {
  readonly mode: "memory" | "supabase";
  listCases(): Promise<ClinicalCase[]>;
  getCase(caseId: string): Promise<ClinicalCase | null>;
  createSession(studentId: string, caseId: string, assignmentId?: string): Promise<SessionBundle>;
  /** Start (or resume) the session belonging to an authorised student assignment. */
  createSessionForAssignment(studentId: string, assignmentId: string): Promise<SessionBundle>;
  getSession(sessionId: string): Promise<SessionBundle | null>;
  /**
   * Find an already committed student turn for a retry key. Implementations
   * must verify session ownership and reject the same key with different text.
   */
  findCommittedTurn(
    sessionId: string,
    studentId: string,
    clientRequestId: string,
    content: string,
  ): Promise<SessionBundle | null>;
  commitTurn(input: CommitTurnInput): Promise<SessionBundle>;
  completeSession(
    sessionId: string,
    summary: SessionSummary,
    completedAt: string,
  ): Promise<SessionBundle>;
  setSessionPaused(sessionId: string, pausedAt: string | null): Promise<SessionBundle>;
  listSessions(): Promise<SessionBundle[]>;
  saveReview(input: SaveReviewInput): Promise<SessionBundle>;
  listUsers(): Promise<DemoUser[]>;
  updateUser(userId: string, patch: Partial<Pick<DemoUser, "name" | "email" | "isActive">>): Promise<DemoUser>;
  listClasses(userId?: string): Promise<TeachingClass[]>;
  saveClass(input: Omit<TeachingClass, "id" | "createdAt" | "members"> & { id?: string }): Promise<TeachingClass>;
  setClassMembers(classId: string, members: ClassMembership[]): Promise<TeachingClass>;
  /** Admin-only view of persisted case validation problems; never use for student DTOs. */
  listCaseVersionsWithDiagnostics(): Promise<{ cases: ClinicalCase[]; diagnostics: CaseAttachmentDiagnostic[] }>;
  listCaseVersions(): Promise<ClinicalCase[]>;
  saveCase(input: ClinicalCase, adminId: string): Promise<ClinicalCase>;
  publishCase(caseId: string, moveOpenAssignments?: boolean): Promise<ClinicalCase>;
  archiveCase(caseId: string): Promise<ClinicalCase>;
  cloneCase(caseId: string, adminId: string): Promise<ClinicalCase>;
  listAssignments(professorId?: string): Promise<CaseAssignment[]>;
  saveAssignment(input: Omit<CaseAssignment, "id" | "createdAt" | "assignedBy"> & { id?: string }, professorId: string): Promise<CaseAssignment>;
  listStudentOfferings(studentId: string): Promise<StudentCaseOffering[]>;
  listSessionsForProfessor(professorId: string): Promise<SessionBundle[]>;
  getAdminOverview(): Promise<AdminOverview>;
  reassignReview(sessionId: string, professorId: string | null): Promise<SessionBundle>;
}
