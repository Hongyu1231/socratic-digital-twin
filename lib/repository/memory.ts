import type {
  AdminOverview,
  AnswerReview,
  CaseAssignment,
  ClassMembership,
  ClinicalCase,
  DemoUser,
  LearnerState,
  LearningSession,
  SessionBundle,
  SessionReview,
  SessionSummary,
  StaffSessionPage,
  StaffSessionQuery,
  StudentCaseOffering,
  TeachingClass,
  TutorMessage,
  TutorTurnReview,
} from "@/lib/domain";
import { demoAssignment, demoAssignments, demoCases, demoClass, demoUsers, getDemoUser } from "@/lib/seed";
import { ArchivedCaseError, AssignmentIdempotencyConflictError, IdempotencyConflictError, SupersededCaseError, type CommitTurnInput, type SaveReviewInput, type TutorRepository } from "@/lib/repository/types";
import { getCaseLineageId, getNextCaseVersion, getVersionedCaseTitle } from "@/lib/repository/case-version";
import {
  inspectStoredAttachments,
  normalizeWritableAttachments,
  reportAttachmentDiagnostics,
} from "@/lib/repository/case-attachments";
import { assertCaseStatusTransition } from "@/lib/repository/case-status";
import { reconcileLearnerStateEvidence } from "@/lib/tutor/learner-model";
import { getMaterialPack } from "@/lib/materials/pack";
import { getConfiguredTutorProvider } from "@/lib/tutor/provider-config";
import { latestTutorRuntime } from "@/lib/tutor/runtime";
import {
  accumulateStaffSessionStats,
  addAssignmentProgress,
  decodeStaffSessionCursor,
  emptyStaffSessionStats,
  encodeStaffSessionCursor,
  isAfterStaffCursor,
  matchesStaffReviewFilter,
  normalizeStaffSessionLimit,
  staffReviewState,
} from "@/lib/repository/staff-session";

interface MemoryStore {
  sessions: Map<string, LearningSession>;
  /** Turn request keys are kept separately so they never leak into student-visible messages. */
  turnRequests: Map<string, {
    sessionId: string;
    studentId: string;
    content: string;
    /** Legacy stores predate the operation discriminator; missing means answer. */
    turnKind?: "answer" | "help";
  }>;
  answerReviews: Map<string, AnswerReview>;
  tutorTurnReviews: Map<string, TutorTurnReview>;
  sessionReviews: Map<string, SessionReview>;
  users: Map<string, DemoUser>;
  classes: Map<string, TeachingClass>;
  cases: Map<string, ClinicalCase>;
  assignments: Map<string, CaseAssignment>;
}

const globalStore = globalThis as typeof globalThis & {
  __socraticTutorStore?: MemoryStore;
};

function createStore(): MemoryStore {
  const pack = getMaterialPack();
  const cases = pack ? pack.cases.map((entry) => entry.case) : demoCases;
  const assignments: CaseAssignment[] = pack ? cases.map((clinicalCase) => ({
    id: clinicalCase.id,
    classId: demoClass.id,
    caseId: clinicalCase.id,
    assignedBy: demoAssignment.assignedBy,
    status: "open",
    opensAt: "2026-01-01T00:00:00.000Z",
    dueAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: `local-materials:${clinicalCase.id}`,
    className: demoClass.name,
    caseTitle: clinicalCase.title,
  })) : demoAssignments;
  return {
    sessions: new Map(),
    turnRequests: new Map(),
    answerReviews: new Map(),
    tutorTurnReviews: new Map(),
    sessionReviews: new Map(),
    users: new Map(demoUsers.map((item) => [item.id, clone(item)])),
    classes: new Map([[demoClass.id, clone(demoClass)]]),
    cases: new Map(cases.map((item) => [item.id, clone(item)])),
    assignments: new Map(assignments.map((item) => [item.id, clone(item)])),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeAssignmentTime(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function sameAssignmentRequest(
  current: CaseAssignment,
  input: Omit<CaseAssignment, "id" | "createdAt" | "assignedBy"> & { id?: string },
) {
  return current.classId === input.classId
    && current.caseId === input.caseId
    && current.status === input.status
    && normalizeAssignmentTime(current.opensAt) === normalizeAssignmentTime(input.opensAt)
    && normalizeAssignmentTime(current.dueAt) === normalizeAssignmentTime(input.dueAt);
}

/**
 * Message provenance is deliberately kept local to the repository layer. The
 * domain type is shared with the student transcript and can lag a persisted
 * row while a deploy is rolling out; replay must still understand both
 * tagged Help turns and historical untagged answers.
 */
type PersistedTutorMessage = TutorMessage & {
  turnKind?: "answer" | "help";
  helpRequested?: boolean;
  phaseOrder?: number;
  supportLevel?: 0 | 1 | 2;
  completedWithSupport?: boolean;
  clientRequestId?: string;
};

const HELP_MARKER_CONTENT = "Requested more help";

function messageTurnKind(message: TutorMessage): "answer" | "help" {
  const value = (message as PersistedTutorMessage).turnKind;
  return value === "help" ? "help" : "answer";
}

function assertTurnShape(input: CommitTurnInput) {
  const studentMessage = input.studentMessage as PersistedTutorMessage;
  const aiMessage = input.aiMessage as PersistedTutorMessage;
  const turnKind = messageTurnKind(studentMessage);
  const aiTurnKind = messageTurnKind(aiMessage);
  if (turnKind !== aiTurnKind) throw new Error("Student and tutor turn kinds must match.");
  const studentHelp = studentMessage.helpRequested;
  const aiHelp = aiMessage.helpRequested;
  if (turnKind === "help") {
    if (studentHelp !== true || aiHelp !== true) throw new Error("Help turns must be marked as requested.");
    if (input.evaluation !== null) throw new Error("Help turns cannot include an evaluation.");
    if (studentMessage.content !== HELP_MARKER_CONTENT) throw new Error("Help marker content is server-generated.");
    if (aiMessage.replyToMessageId !== studentMessage.id) throw new Error("Help reply must reference its marker.");
  } else {
    if (studentHelp === true || aiHelp === true) throw new Error("Answer turns cannot be marked as Help.");
    if (input.evaluation === null) throw new Error("Answer turns require an evaluation.");
  }
  if (turnKind === "help" && input.nextState.version !== input.expectedVersion + 1) {
    throw new Error("Help turns must increment session state version exactly once.");
  }
  if (turnKind === "help" && input.status !== "active") {
    throw new Error("Help turns cannot complete a session.");
  }
  return turnKind;
}

function normalizeTurnMessages(messages: TutorMessage[]): TutorMessage[] {
  return messages.map((message, index) => {
    const persisted = message as PersistedTutorMessage;
    if (persisted.turnKind === "help" || persisted.turnKind === "answer") return message;
    if (message.sender === "student"
      || (message.sender === "ai" && messages[index - 1]?.sender === "student")) {
      return { ...message, turnKind: "answer", helpRequested: false } as TutorMessage;
    }
    return message;
  });
}

export class InMemoryTutorRepository implements TutorRepository {
  readonly mode = "memory" as const;
  private readonly store: MemoryStore;

  constructor(store = globalStore.__socraticTutorStore ?? createStore()) {
    this.store = store;
    // Hot-reloaded dev stores can predate the idempotency map.
    if (!this.store.turnRequests) this.store.turnRequests = new Map();
    globalStore.__socraticTutorStore = store;
  }

  async listCases() {
    return [...this.store.cases.values()]
      .filter((item) => item.status === "available")
      .map((item) => this.readableCase(item));
  }

  async getCase(caseId: string) {
    const current = this.store.cases.get(caseId);
    return current ? this.readableCase(current) : null;
  }

  async createSession(studentId: string, caseId: string, assignmentId?: string) {
    const assignment = assignmentId ? this.store.assignments.get(assignmentId) : undefined;
    if (assignmentId && (!assignment || assignment.caseId !== caseId)) throw new Error("Case assignment not found.");
    if (assignment) {
      const teachingClass = this.store.classes.get(assignment.classId);
      const isMember = teachingClass?.members.some((item) => item.userId === studentId && item.role === "student");
      if (!isMember) throw new Error("This case assignment is not available to you.");
      const clinicalCase = this.store.cases.get(caseId);
      if (clinicalCase?.status === "archived") throw new ArchivedCaseError();
      if (!clinicalCase || (clinicalCase.status !== "available" && clinicalCase.status !== "superseded")) throw new Error("This case is not currently available.");
      const existing = [...this.store.sessions.values()].find((item) => item.studentId === studentId && item.assignmentId === assignmentId);
      if (existing) return this.bundle(existing);
      const now = new Date().toISOString();
      if (assignment.status !== "open" || assignment.opensAt > now || (assignment.dueAt && assignment.dueAt <= now)) {
        throw new Error("This case assignment is not currently available.");
      }
    }
    const clinicalCase = await this.getCase(caseId);
    const student = getDemoUser(studentId);
    if (!clinicalCase || !student || student.role !== "student") {
      throw new Error("Unable to create session for the selected case and learner.");
    }
    if (clinicalCase.status === "archived") throw new ArchivedCaseError();
    if (clinicalCase.status === "superseded" && !assignmentId) throw new SupersededCaseError();
    if (clinicalCase.status !== "available" && !(clinicalCase.status === "superseded" && assignmentId)) throw new Error("This case is not currently available.");

    // The assignment lookup above occurs before the case read.  Re-check after
    // that await so concurrent in-memory starts have the same resume semantics
    // as the database uniqueness/RPC path.
    if (assignmentId) {
      const resumed = [...this.store.sessions.values()].find((item) => item.studentId === studentId && item.assignmentId === assignmentId);
      if (resumed) return this.bundle(resumed);
    }

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const state: LearnerState = {
      sessionId,
      currentGoal: clinicalCase.phases[0].goal,
      previousErrors: [],
      strengths: [],
      weaknesses: [],
      nextStrategy: "probe",
      phaseAttempts: { "1": 0 },
      mastery: Object.fromEntries(clinicalCase.phases.map((phase) => [String(phase.order), 0])),
      usedTutorMoves: [],
      version: 1,
      updatedAt: now,
    };
    const session: LearningSession = {
      id: sessionId,
      studentId,
      caseId,
      currentPhase: 1,
      status: "active",
      reviewStatus: "pending",
      score: null,
      summary: null,
      createdAt: now,
      completedAt: null,
      pausedAt: null,
      assignmentId: assignmentId ?? demoAssignment.id,
      reviewerId: null,
      messages: [
        {
          id: crypto.randomUUID(),
          sessionId,
          sender: "ai",
          content: clinicalCase.phases[0].starterQuestion,
          timestamp: now,
        },
      ],
      evaluations: [],
      state,
    };
    this.store.sessions.set(sessionId, clone(session));
    return this.bundle(session);
  }

  async createSessionForAssignment(studentId: string, assignmentId: string) {
    const assignment = this.store.assignments.get(assignmentId);
    const teachingClass = assignment ? this.store.classes.get(assignment.classId) : undefined;
    const isMember = teachingClass?.members.some((item) => item.userId === studentId && item.role === "student");
    if (!assignment || !teachingClass || !isMember) throw new Error("This case assignment is not available to you.");
    const clinicalCase = this.store.cases.get(assignment.caseId);
    if (clinicalCase?.status === "archived") throw new ArchivedCaseError();
    if (!clinicalCase || (clinicalCase.status !== "available" && clinicalCase.status !== "superseded")) throw new Error("This case is not currently available.");
    return this.createSession(studentId, assignment.caseId, assignmentId);
  }

  async getSession(sessionId: string) {
    const session = this.store.sessions.get(sessionId);
    return session ? this.bundle(session) : null;
  }

  private findCommittedTurnSync(
    sessionId: string,
    studentId: string,
    clientRequestId: string,
    content: string,
    turnKind: "answer" | "help" = "answer",
  ) {
    const current = this.store.sessions.get(sessionId);
    if (!current) return null;
    if (current.studentId !== studentId) throw new Error("This session belongs to another learner.");
    const request = this.store.turnRequests.get(this.turnRequestKey(sessionId, clientRequestId));
    if (!request) return null;
    if (request.studentId !== studentId
      || request.content !== content
      || (request.turnKind ?? "answer") !== turnKind) {
      throw new IdempotencyConflictError();
    }
    return this.bundle(current);
  }

  async findCommittedTurn(
    sessionId: string,
    studentId: string,
    clientRequestId: string,
    content: string,
    turnKind: "answer" | "help" = "answer",
  ) {
    const normalizedRequestId = clientRequestId.trim();
    if (!normalizedRequestId) return null;
    return this.findCommittedTurnSync(sessionId, studentId, normalizedRequestId, content, turnKind);
  }

  async commitTurn(input: CommitTurnInput) {
    const current = this.store.sessions.get(input.sessionId);
    if (!current) throw new Error("Session not found.");
    const turnKind = messageTurnKind(input.studentMessage);
    // Keep this lookup synchronous and before status/version checks. An async
    // lookup here would allow two same-key calls to interleave in memory.
    const normalizedRequestId = input.clientRequestId?.trim();
    if (input.clientRequestId !== undefined && !normalizedRequestId) {
      throw new Error("Client request ID cannot be blank.");
    }
    if (normalizedRequestId) {
      const existing = this.findCommittedTurnSync(
        input.sessionId,
        current.studentId,
        normalizedRequestId,
        input.studentMessage.content,
        turnKind,
      );
      if (existing) return existing;
    }
    assertTurnShape(input);
    if (turnKind === "help" && !normalizedRequestId) {
      throw new Error("Help turns require a client request ID.");
    }
    if (current.status !== "active") throw new Error("Session is already complete.");
    if (current.pausedAt) throw new Error("Resume this session before submitting another answer.");
    if (current.state.version !== input.expectedVersion) {
      throw new Error("Session changed. Refresh before submitting another answer.");
    }
    if (turnKind === "help" && input.nextPhase !== current.currentPhase) {
      throw new Error("Help turns cannot advance the session phase.");
    }

    const persistedStudentMessage = turnKind === "help" && normalizedRequestId
      ? { ...input.studentMessage, clientRequestId: normalizedRequestId } as TutorMessage
      : input.studentMessage;
    const persistedAiMessage = turnKind === "help" && normalizedRequestId
      ? { ...input.aiMessage, clientRequestId: normalizedRequestId } as TutorMessage
      : input.aiMessage;
    const next: LearningSession = {
      ...current,
      currentPhase: input.nextPhase,
      status: input.status,
      score: input.score,
      summary: input.summary,
      completedAt: input.completedAt,
      pausedAt: null,
      messages: [...current.messages, persistedStudentMessage, persistedAiMessage],
      evaluations: input.evaluation ? [...current.evaluations, input.evaluation] : [...current.evaluations],
      state: clone(input.nextState),
    };
    this.store.sessions.set(next.id, clone(next));
    if (normalizedRequestId) {
      this.store.turnRequests.set(this.turnRequestKey(input.sessionId, normalizedRequestId), {
        sessionId: input.sessionId,
        studentId: current.studentId,
        content: input.studentMessage.content,
        turnKind,
      });
    }
    return this.bundle(next);
  }

  async completeSession(sessionId: string, summary: SessionSummary, completedAt: string) {
    const current = this.store.sessions.get(sessionId);
    if (!current) throw new Error("Session not found.");
    const next = {
      ...current,
      status: "completed" as const,
      score: summary.overallScore,
      summary: clone(summary),
      completedAt,
      pausedAt: null,
    };
    this.store.sessions.set(sessionId, next);
    return this.bundle(next);
  }

  async setSessionPaused(sessionId: string, pausedAt: string | null) {
    const current = this.store.sessions.get(sessionId);
    if (!current) throw new Error("Session not found.");
    if (current.status !== "active") throw new Error("Completed sessions cannot be paused or resumed.");
    const next = { ...current, pausedAt };
    this.store.sessions.set(sessionId, clone(next));
    return this.bundle(next);
  }

  async listSessions() {
    return Promise.all(
      [...this.store.sessions.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((session) => this.bundle(session)),
    );
  }

  async saveReview(input: SaveReviewInput) {
    const session = this.store.sessions.get(input.sessionId);
    if (!session) throw new Error("Session not found.");
    if (session.status !== "completed") throw new Error("Only completed sessions can be reviewed.");
    const teachingClass = this.classForAssignment(session.assignmentId);
    if (!teachingClass?.members.some((item) => item.userId === input.professorId && item.role === "professor")) {
      throw new Error("This review is outside the professor's classes.");
    }
    if (session.reviewerId && session.reviewerId !== input.professorId) throw new Error("Review already claimed by another professor.");
    const validEvaluationIds = new Set(session.evaluations.map((evaluation) => evaluation.id));
    const evaluationById = new Map(session.evaluations.map((evaluation) => [evaluation.id, evaluation]));
    const validTutorMessages = new Set(session.messages.filter((message) => message.sender === "ai").map((message) => message.id));
    const now = new Date().toISOString();
    for (const review of input.reviews) {
      if (!validEvaluationIds.has(review.evaluationId)) throw new Error("Review references an answer outside this session.");
    }
    const gradedReviews = input.reviews.filter((review) => !evaluationById.get(review.evaluationId)?.isReflection);
    for (const review of input.tutorReviews ?? []) {
      if (!validEvaluationIds.has(review.evaluationId) || !validTutorMessages.has(review.tutorMessageId)) {
        throw new Error("Tutor review references a turn outside this session.");
      }
      const evaluation = session.evaluations.find((item) => item.id === review.evaluationId)!;
      const studentMessageIndex = session.messages.findIndex((message) => message.id === evaluation.messageId);
      const expectedTutorMessage = session.messages.slice(studentMessageIndex + 1).find((message) => message.sender === "ai");
      if (expectedTutorMessage?.id !== review.tutorMessageId) throw new Error("Tutor review does not match the evaluated answer.");
    }
    session.reviewerId = input.professorId;
    for (const review of gradedReviews) {
      this.store.answerReviews.set(review.evaluationId, {
        ...review,
        professorId: input.professorId,
        updatedAt: now,
      });
    }
    for (const review of input.tutorReviews ?? []) {
      this.store.tutorTurnReviews.set(review.evaluationId, {
        ...review,
        professorId: input.professorId,
        updatedAt: now,
      });
    }
    const labels = gradedReviews.map((review) => review.label);
    const scoreMap = { correct: 100, partial: 70, vague: 40, wrong: 0 } as const;
    const finalScore = labels.length
      ? Math.round(labels.reduce((sum, label) => sum + scoreMap[label], 0) / labels.length)
      : null;
    this.store.sessionReviews.set(input.sessionId, {
      sessionId: input.sessionId,
      professorId: input.professorId,
      overallFeedback: input.overallFeedback,
      status: input.status,
      finalScore,
      updatedAt: now,
    });
    this.store.sessions.set(input.sessionId, {
      ...session,
      reviewStatus: input.status === "completed" ? "completed" : "in_review",
    });
    return this.bundle(this.store.sessions.get(input.sessionId)!);
  }

  reset() {
    this.store.sessions.clear();
    this.store.turnRequests.clear();
    this.store.answerReviews.clear();
    this.store.tutorTurnReviews.clear();
    this.store.sessionReviews.clear();
    this.store.users = new Map(demoUsers.map((item) => [item.id, clone(item)]));
    this.store.classes = new Map([[demoClass.id, clone(demoClass)]]);
    const fresh = createStore();
    this.store.cases = fresh.cases;
    this.store.assignments = fresh.assignments;
  }

  async listUsers() { return clone([...this.store.users.values()]); }

  async updateUser(userId: string, patch: Partial<Pick<DemoUser, "name" | "email" | "isActive">>) {
    const current = this.store.users.get(userId);
    if (!current) throw new Error("User not found.");
    const next = { ...current, ...patch };
    this.store.users.set(userId, next);
    return clone(next);
  }

  async listClasses(userId?: string) {
    return clone([...this.store.classes.values()].filter((item) => !userId || item.members.some((member) => member.userId === userId)));
  }

  async saveClass(input: Omit<TeachingClass, "id" | "createdAt" | "members"> & { id?: string }) {
    const current = input.id ? this.store.classes.get(input.id) : undefined;
    const next: TeachingClass = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: current?.createdAt ?? new Date().toISOString(), members: current?.members ?? [] };
    this.store.classes.set(next.id, clone(next));
    return clone(next);
  }

  async setClassMembers(classId: string, members: ClassMembership[]) {
    const current = this.store.classes.get(classId);
    if (!current) throw new Error("Class not found.");
    if (!members.some((item) => item.role === "professor" && item.isLead)) throw new Error("A lead professor is required.");
    const next = { ...current, members: clone(members) };
    this.store.classes.set(classId, next);
    return clone(next);
  }

  async listCaseVersionsWithDiagnostics() {
    const mapped = [...this.store.cases.values()].map((item) => {
      const inspection = inspectStoredAttachments(item.id, item.attachments ?? [], item.phases.map((phase) => phase.order));
      reportAttachmentDiagnostics(inspection.diagnostics);
      return {
        case: clone({ ...item, attachments: inspection.valid }),
        diagnostics: inspection.diagnostics,
      };
    });
    return { cases: mapped.map((item) => item.case), diagnostics: mapped.flatMap((item) => item.diagnostics) };
  }

  async listCaseVersions() { return (await this.listCaseVersionsWithDiagnostics()).cases; }

  async saveCase(input: ClinicalCase, adminId: string) {
    void adminId;
    const current = input.id ? this.store.cases.get(input.id) : undefined;
    if (input.id && !current) throw new Error("Case not found.");
    const existingInspection = current ? inspectStoredAttachments(current.id, current.attachments ?? [], current.phases.map((phase) => phase.order)) : null;
    if (existingInspection?.diagnostics.length) {
      throw new Error("Cannot save a case while it contains invalid stored attachments.");
    }
    if (current && current.status !== "draft") throw new Error("Published cases are immutable. Clone a new version.");
    const id = input.id || crypto.randomUUID();
    const attachments = normalizeWritableAttachments(id, input.attachments ?? current?.attachments ?? []);
    const next = { ...clone(input), id, status: "draft" as const, version: input.version ?? 1, publishedAt: null, attachments };
    next.phases = next.phases.map((phase, index) => ({ ...phase, id: phase.id || crypto.randomUUID(), caseId: next.id, order: index + 1 }));
    this.store.cases.set(next.id, next);
    return clone(next);
  }

  async publishCase(caseId: string, moveOpenAssignments = true) {
    const current = this.store.cases.get(caseId);
    if (!current) throw new Error("Case not found.");
    const inspection = inspectStoredAttachments(caseId, current.attachments ?? [], current.phases.map((phase) => phase.order));
    if (inspection.diagnostics.length) throw new Error("Cannot publish a case while it contains invalid stored attachments.");
    if (!current.phases.length) throw new Error("Case must contain at least one phase before publication.");
    assertCaseStatusTransition("publish", current.status === "available" ? "active" : current.status);
    const lineageId = getCaseLineageId(current);
    const lineageRoot = this.store.cases.get(lineageId);
    if (!lineageRoot || lineageRoot.sourceCaseId) throw new Error("Case sourceCaseId must point to a lineage root.");
    if ((lineageRoot.version ?? 1) !== 1) throw new Error("A lineage root must use version 1.");
    if (current.sourceCaseId === null || current.sourceCaseId === undefined) {
      if ((current.version ?? 1) !== 1) throw new Error("A root case must use version 1.");
    } else if ((current.version ?? 1) <= (lineageRoot.version ?? 1)) {
      throw new Error("A linked case version must be newer than its source root.");
    }
    const lineage = [...this.store.cases.values()].filter((item) => getCaseLineageId(item) === lineageId);
    const activeVersions = lineage.filter((item) => item.status === "available");
    if (activeVersions.length > 1) throw new Error("Cannot publish a lineage with multiple active versions.");
    if (lineage.some((item) => (item.version ?? 1) > (current.version ?? 1))) {
      throw new Error("Case version is older than an existing version in its lineage.");
    }
    const previous = activeVersions[0];
    if (previous) {
      this.store.cases.set(previous.id, clone({ ...previous, status: "superseded" }));
      if (moveOpenAssignments) {
        for (const [assignmentId, assignment] of this.store.assignments) {
          if (assignment.caseId === previous.id && assignment.status === "open") {
            this.store.assignments.set(assignmentId, clone({ ...assignment, caseId, caseTitle: current.title }));
          }
        }
      }
    }
    const next = { ...current, status: "available" as const, publishedAt: new Date().toISOString() };
    this.store.cases.set(caseId, next);
    return clone(next);
  }

  async archiveCase(caseId: string) {
    const current = this.store.cases.get(caseId);
    if (!current) throw new Error("Case not found.");
    assertCaseStatusTransition("archive", current.status === "available" ? "active" : current.status);
    const next: ClinicalCase = { ...current, status: "archived" };
    this.store.cases.set(caseId, next);
    for (const [assignmentId, assignment] of this.store.assignments) {
      if (assignment.caseId === caseId && assignment.status === "open") {
        this.store.assignments.set(assignmentId, clone({ ...assignment, status: "closed" }));
      }
    }
    return clone(next);
  }

  async cloneCase(caseId: string, adminId: string) {
    void adminId;
    const current = this.store.cases.get(caseId);
    if (!current) throw new Error("Case not found.");
    const inspection = inspectStoredAttachments(caseId, current.attachments ?? [], current.phases.map((phase) => phase.order));
    if (inspection.diagnostics.length) throw new Error("Cannot clone a case while it contains invalid stored attachments.");
    const id = crypto.randomUUID();
    const version = getNextCaseVersion([...this.store.cases.values()], current);
    const next: ClinicalCase = { ...clone(current), id, title: getVersionedCaseTitle(current.title, version), status: "draft", sourceCaseId: getCaseLineageId(current), version, publishedAt: null, phases: current.phases.map((phase) => ({ ...phase, id: crypto.randomUUID(), caseId: id })) };
    this.store.cases.set(id, next);
    return clone(next);
  }

  async listAssignments(professorId?: string) {
    return clone([...this.store.assignments.values()].filter((item) => !professorId || this.store.classes.get(item.classId)?.members.some((member) => member.userId === professorId && member.role === "professor")));
  }

  async saveAssignment(input: Omit<CaseAssignment, "id" | "createdAt" | "assignedBy"> & { id?: string }, professorId: string) {
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && !idempotencyKey) throw new Error("Assignment idempotency key cannot be blank.");
    const existingByKey = idempotencyKey ? [...this.store.assignments.values()].find((item) => item.idempotencyKey === idempotencyKey) : undefined;
    const current = input.id ? this.store.assignments.get(input.id) : existingByKey;
    if (input.id && !current) throw new Error("Assignment not found.");
    const teachingClass = this.store.classes.get(input.classId);
    if (!teachingClass?.members.some((item) => item.userId === professorId && item.role === "professor")) throw new Error("Professor is outside this class.");
    if (current) {
      const currentClass = this.store.classes.get(current.classId);
      if (!currentClass?.members.some((item) => item.userId === professorId && item.role === "professor")) throw new Error("Professor is outside this class.");
    }
    if (!input.id && existingByKey) {
      if (!sameAssignmentRequest(existingByKey, input)) throw new AssignmentIdempotencyConflictError();
      return clone(existingByKey);
    }
    if (input.id && existingByKey && existingByKey.id !== input.id) {
      throw new AssignmentIdempotencyConflictError();
    }
    const clinicalCase = this.store.cases.get(input.caseId);
    if (!clinicalCase) throw new Error("Case not found.");
    const caseOrClassChanged = current ? current.caseId !== input.caseId || current.classId !== input.classId : true;
    if (caseOrClassChanged) {
      if (clinicalCase.status !== "available") throw new Error("Case assignment conflict: only active cases can be assigned.");
    } else if (clinicalCase.status === "archived") {
      if (input.status === "open") throw new Error("Archived case assignments cannot be reopened.");
    } else if (clinicalCase.status !== "available" && clinicalCase.status !== "superseded") {
      throw new Error("Case assignment conflict: only active cases can be assigned.");
    }
    const next: CaseAssignment = { ...input, id: input.id || existingByKey?.id || crypto.randomUUID(), idempotencyKey, assignedBy: current?.assignedBy ?? professorId, createdAt: current?.createdAt ?? new Date().toISOString(), className: teachingClass.name, caseTitle: clinicalCase.title };
    this.store.assignments.set(next.id, clone(next));
    return clone(next);
  }

  async listStaffSessions(query: StaffSessionQuery = {}, professorId?: string): Promise<StaffSessionPage> {
    const limit = normalizeStaffSessionLimit(query.limit);
    const cursor = decodeStaffSessionCursor(query.cursor);
    const reviewFilter = query.reviewFilter ?? "all";
    const allowedClassIds = professorId
      ? new Set([...this.store.classes.values()]
        .filter((teachingClass) => teachingClass.members.some((member) => member.userId === professorId && member.role === "professor"))
        .map((teachingClass) => teachingClass.id))
      : null;
    const assignments = [...this.store.assignments.values()].filter((assignment) =>
      (!allowedClassIds || allowedClassIds.has(assignment.classId)) && (!query.classId || assignment.classId === query.classId),
    );
    const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
    const allSessions = [...this.store.sessions.values()]
      .filter((session) => session.assignmentId && assignmentById.has(session.assignmentId));
    const stats = emptyStaffSessionStats();
    const assignmentProgress: Record<string, { sessionCount: number; completedCount: number }> = {};
    for (const session of allSessions) {
      accumulateStaffSessionStats(stats, session, professorId);
      addAssignmentProgress(assignmentProgress, session.assignmentId, session.status);
    }
    const sorted = allSessions
      .filter((session) => matchesStaffReviewFilter(staffReviewState(session, professorId), reviewFilter))
      .filter((session) => isAfterStaffCursor(session.createdAt, session.id, cursor))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const page = sorted.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const visible = page.slice(0, limit);
    return {
      sessions: visible.map((session) => {
        const assignment = session.assignmentId ? assignmentById.get(session.assignmentId) : undefined;
        if (!assignment) throw new Error("Staff session references missing assignment data.");
        return this.staffSessionSummary(session, assignment, professorId);
      }),
      nextCursor: hasMore ? encodeStaffSessionCursor({ createdAt: visible.at(-1)!.createdAt, id: visible.at(-1)!.id }) : null,
      stats,
      assignmentProgress,
    };
  }

  async listStudentOfferings(studentId: string): Promise<StudentCaseOffering[]> {
    const now = new Date().toISOString();
    const classes = [...this.store.classes.values()].filter((item) => item.members.some((member) => member.userId === studentId && member.role === "student"));
    return classes.flatMap((teachingClass): StudentCaseOffering[] => [...this.store.assignments.values()].filter((item) => item.classId === teachingClass.id).flatMap((assignment) => {
      const existing = [...this.store.sessions.values()].find((item) => item.studentId === studentId && item.assignmentId === assignment.id);
      const storedCase = this.store.cases.get(existing?.caseId ?? assignment.caseId);
      const clinicalCase = storedCase ? this.readableCase(storedCase) : undefined;
      if (!clinicalCase || (clinicalCase.status === "archived" && !existing) || (clinicalCase as ClinicalCase & { isTestFixture?: boolean }).isTestFixture) return [];
      const offering: StudentCaseOffering = {
        assignment: clone(assignment),
        teachingClass: clone(teachingClass),
        case: clone(clinicalCase),
        existingSessionId: existing?.id ?? null,
        existingSessionStatus: existing?.status ?? null,
        existingSessionPausedAt: existing?.pausedAt ?? null,
        availability: assignment.status !== "open" || (assignment.dueAt && assignment.dueAt <= now) ? "closed" as const : assignment.opensAt > now ? "upcoming" as const : "open" as const,
      };
      return offering.availability === "open" || offering.availability === "upcoming" ? [offering] : [];
    }));
  }

  async listSessionsForProfessor(professorId: string) {
    const classIds = new Set((await this.listClasses(professorId)).map((item) => item.id));
    const assignmentIds = new Set([...this.store.assignments.values()].filter((item) => classIds.has(item.classId)).map((item) => item.id));
    return Promise.all([...this.store.sessions.values()].filter((item) => item.assignmentId && assignmentIds.has(item.assignmentId)).map((item) => this.bundle(item, professorId)));
  }

  async getAdminOverview(): Promise<AdminOverview> {
    const completed = [...this.store.sessions.values()].filter((item) => item.status === "completed").length;
    const pendingReviewCount = [...this.store.sessions.values()].filter((item) => item.status === "completed" && item.reviewStatus !== "completed").length;
    return {
      userCount: this.store.users.size,
      classCount: this.store.classes.size,
      openAssignmentCount: [...this.store.assignments.values()].filter((item) => item.status === "open").length,
      sessionCount: this.store.sessions.size,
      pendingReviewCount,
      completionRate: this.store.sessions.size ? Math.round((completed / this.store.sessions.size) * 100) : 0,
      unclaimedReviewCount: [...this.store.sessions.values()].filter((item) => item.status === "completed" && item.reviewStatus !== "completed" && !item.reviewerId).length,
    };
  }

  async reassignReview(sessionId: string, professorId: string | null) {
    const session = this.store.sessions.get(sessionId);
    if (!session) throw new Error("Session not found.");
    if (session.reviewStatus === "completed") throw new Error("Completed reviews cannot be reassigned.");
    session.reviewerId = professorId;
    return this.bundle(session, professorId ?? undefined);
  }

  private classForAssignment(assignmentId?: string | null) {
    const assignment = assignmentId ? this.store.assignments.get(assignmentId) : undefined;
    return assignment ? this.store.classes.get(assignment.classId) : undefined;
  }

  private staffSessionSummary(session: LearningSession, assignment: CaseAssignment, professorId?: string) {
    const clinicalCase = this.store.cases.get(session.caseId);
    const student = this.store.users.get(session.studentId);
    const teachingClass = this.store.classes.get(assignment.classId);
    if (!clinicalCase || !student || !teachingClass) throw new Error("Staff session references missing related data.");
    const state = staffReviewState(session, professorId);
    const claimState: NonNullable<SessionBundle["reviewClaim"]>["state"] = state === "claimed" ? "other" : state === "mine" ? "mine" : state === "completed" ? "completed" : "unclaimed";
    const reviewer = session.reviewerId ? this.store.users.get(session.reviewerId) : undefined;
    return {
      session: {
        id: session.id,
        caseId: session.caseId,
        studentId: session.studentId,
        assignmentId: session.assignmentId ?? null,
        status: session.status,
        reviewStatus: session.reviewStatus,
        score: session.score,
        createdAt: session.createdAt,
        completedAt: session.completedAt,
        reviewerId: session.reviewerId ?? null,
      },
      case: { id: clinicalCase.id, title: clinicalCase.title, ...(clinicalCase.version === undefined ? {} : { version: clinicalCase.version }) },
      student: { id: student.id, name: student.name },
      assignment: { id: assignment.id, classId: assignment.classId },
      teachingClass: { id: teachingClass.id, name: teachingClass.name },
      reviewClaim: {
        reviewerId: session.reviewerId ?? null,
        reviewerName: reviewer?.name ?? null,
        state: claimState,
        canEdit: session.reviewStatus !== "completed" && (!session.reviewerId || session.reviewerId === professorId),
      },
    };
  }

  private readableCase(current: ClinicalCase): ClinicalCase {
    const inspection = inspectStoredAttachments(current.id, current.attachments ?? [], current.phases.map((phase) => phase.order));
    reportAttachmentDiagnostics(inspection.diagnostics);
    return clone({ ...current, attachments: inspection.valid });
  }

  private turnRequestKey(sessionId: string, clientRequestId: string) {
    return `${sessionId}\u0000${clientRequestId}`;
  }

  private bundle(session: LearningSession, viewerId?: string): SessionBundle {
    const storedCase = this.store.cases.get(session.caseId);
    const clinicalCase = storedCase ? this.readableCase(storedCase) : undefined;
    const student = this.store.users.get(session.studentId) ?? getDemoUser(session.studentId);
    if (!clinicalCase || !student) throw new Error("Seed relationship is invalid.");
    const reconciledSession = {
      ...session,
      messages: normalizeTurnMessages(session.messages),
      state: reconcileLearnerStateEvidence(session.state),
    };
    return clone({
      session: reconciledSession,
      case: clinicalCase,
      student,
      answerReviews: session.evaluations
        .map((evaluation) => this.store.answerReviews.get(evaluation.id))
        .filter((review): review is AnswerReview => Boolean(review)),
      tutorTurnReviews: session.evaluations
        .map((evaluation) => this.store.tutorTurnReviews.get(evaluation.id))
        .filter((review): review is TutorTurnReview => Boolean(review)),
      sessionReview: this.store.sessionReviews.get(session.id) ?? null,
      runtime: {
        storage: "memory",
        ...latestTutorRuntime(session, getConfiguredTutorProvider()),
      },
      summaryGenerationStatus: session.status === "completed" && !session.summary ? "pending" as const : "ready" as const,
      assignment: session.assignmentId ? this.store.assignments.get(session.assignmentId) ?? null : null,
      teachingClass: this.classForAssignment(session.assignmentId) ?? null,
      reviewClaim: { reviewerId: session.reviewerId ?? null, reviewerName: session.reviewerId ? this.store.users.get(session.reviewerId)?.name ?? null : null, state: session.reviewStatus === "completed" ? "completed" : !session.reviewerId ? "unclaimed" : session.reviewerId === viewerId ? "mine" : "other", canEdit: session.reviewStatus !== "completed" && (!session.reviewerId || session.reviewerId === viewerId) },
    });
  }
}
