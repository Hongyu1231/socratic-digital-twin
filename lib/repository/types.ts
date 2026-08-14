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

export interface CommitTurnInput {
  sessionId: string;
  expectedVersion: number;
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
  getSession(sessionId: string): Promise<SessionBundle | null>;
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
  listCaseVersions(): Promise<ClinicalCase[]>;
  saveCase(input: ClinicalCase, adminId: string): Promise<ClinicalCase>;
  publishCase(caseId: string): Promise<ClinicalCase>;
  archiveCase(caseId: string): Promise<ClinicalCase>;
  cloneCase(caseId: string, adminId: string): Promise<ClinicalCase>;
  listAssignments(professorId?: string): Promise<CaseAssignment[]>;
  saveAssignment(input: Omit<CaseAssignment, "id" | "createdAt" | "assignedBy"> & { id?: string }, professorId: string): Promise<CaseAssignment>;
  listStudentOfferings(studentId: string): Promise<StudentCaseOffering[]>;
  listSessionsForProfessor(professorId: string): Promise<SessionBundle[]>;
  getAdminOverview(): Promise<AdminOverview>;
  reassignReview(sessionId: string, professorId: string | null): Promise<SessionBundle>;
}
