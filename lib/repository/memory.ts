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
  StudentCaseOffering,
  TeachingClass,
  TutorTurnReview,
} from "@/lib/domain";
import { demoAssignment, demoAssignments, demoCases, demoClass, demoUsers, getDemoUser } from "@/lib/seed";
import { ArchivedCaseError, type CommitTurnInput, type SaveReviewInput, type TutorRepository } from "@/lib/repository/types";
import { getCaseLineageId, getNextCaseVersion, getVersionedCaseTitle } from "@/lib/repository/case-version";

interface MemoryStore {
  sessions: Map<string, LearningSession>;
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
  return {
    sessions: new Map(),
    answerReviews: new Map(),
    tutorTurnReviews: new Map(),
    sessionReviews: new Map(),
    users: new Map(demoUsers.map((item) => [item.id, clone(item)])),
    classes: new Map([[demoClass.id, clone(demoClass)]]),
    cases: new Map(demoCases.map((item) => [item.id, clone(item)])),
    assignments: new Map(demoAssignments.map((item) => [item.id, clone(item)])),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTutorRepository implements TutorRepository {
  readonly mode = "memory" as const;
  private readonly store: MemoryStore;

  constructor(store = globalStore.__socraticTutorStore ?? createStore()) {
    this.store = store;
    globalStore.__socraticTutorStore = store;
  }

  async listCases() {
    return clone([...this.store.cases.values()].filter((item) => item.status === "available"));
  }

  async getCase(caseId: string) {
    return clone(this.store.cases.get(caseId) ?? null);
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
      if (!clinicalCase || clinicalCase.status !== "available") throw new Error("This case is not currently available.");
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
    if (clinicalCase.status !== "available") throw new Error("This case is not currently available.");

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
    if (!clinicalCase || clinicalCase.status !== "available") throw new Error("This case is not currently available.");
    return this.createSession(studentId, assignment.caseId, assignmentId);
  }

  async getSession(sessionId: string) {
    const session = this.store.sessions.get(sessionId);
    return session ? this.bundle(session) : null;
  }

  async commitTurn(input: CommitTurnInput) {
    const current = this.store.sessions.get(input.sessionId);
    if (!current) throw new Error("Session not found.");
    if (current.status !== "active") throw new Error("Session is already complete.");
    if (current.pausedAt) throw new Error("Resume this session before submitting another answer.");
    if (current.state.version !== input.expectedVersion) {
      throw new Error("Session changed. Refresh before submitting another answer.");
    }

    const next: LearningSession = {
      ...current,
      currentPhase: input.nextPhase,
      status: input.status,
      score: input.score,
      summary: input.summary,
      completedAt: input.completedAt,
      pausedAt: null,
      messages: [...current.messages, input.studentMessage, input.aiMessage],
      evaluations: [...current.evaluations, input.evaluation],
      state: clone(input.nextState),
    };
    this.store.sessions.set(next.id, clone(next));
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
    const validTutorMessages = new Set(session.messages.filter((message) => message.sender === "ai").map((message) => message.id));
    const now = new Date().toISOString();
    for (const review of input.reviews) {
      if (!validEvaluationIds.has(review.evaluationId)) throw new Error("Review references an answer outside this session.");
    }
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
    for (const review of input.reviews) {
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
    const labels = input.reviews.map((review) => review.label);
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
    this.store.answerReviews.clear();
    this.store.tutorTurnReviews.clear();
    this.store.sessionReviews.clear();
    this.store.users = new Map(demoUsers.map((item) => [item.id, clone(item)]));
    this.store.classes = new Map([[demoClass.id, clone(demoClass)]]);
    this.store.cases = new Map(demoCases.map((item) => [item.id, clone(item)]));
    this.store.assignments = new Map(demoAssignments.map((item) => [item.id, clone(item)]));
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

  async listCaseVersions() { return clone([...this.store.cases.values()]); }

  async saveCase(input: ClinicalCase, adminId: string) {
    void adminId;
    const current = input.id ? this.store.cases.get(input.id) : undefined;
    if (current && current.status !== "draft") throw new Error("Published cases are immutable. Clone a new version.");
    const next = { ...clone(input), id: input.id || crypto.randomUUID(), status: "draft" as const, version: input.version ?? 1, publishedAt: null };
    next.phases = next.phases.map((phase, index) => ({ ...phase, id: phase.id || crypto.randomUUID(), caseId: next.id, order: index + 1 }));
    this.store.cases.set(next.id, next);
    return clone(next);
  }

  async publishCase(caseId: string) {
    const current = this.store.cases.get(caseId);
    if (!current) throw new Error("Case not found.");
    const next = { ...current, status: "available" as const, publishedAt: new Date().toISOString() };
    this.store.cases.set(caseId, next);
    return clone(next);
  }

  async archiveCase(caseId: string) {
    const current = this.store.cases.get(caseId);
    if (!current) throw new Error("Case not found.");
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
    const teachingClass = this.store.classes.get(input.classId);
    if (!teachingClass?.members.some((item) => item.userId === professorId && item.role === "professor")) throw new Error("Professor is outside this class.");
    const clinicalCase = this.store.cases.get(input.caseId);
    if (!clinicalCase || clinicalCase.status !== "available") throw new Error("Only published cases can be assigned.");
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && !idempotencyKey) throw new Error("Assignment idempotency key cannot be blank.");
    const existingByKey = idempotencyKey ? [...this.store.assignments.values()].find((item) => item.idempotencyKey === idempotencyKey) : undefined;
    const current = input.id ? this.store.assignments.get(input.id) : existingByKey;
    const next: CaseAssignment = { ...input, id: input.id || existingByKey?.id || crypto.randomUUID(), idempotencyKey, assignedBy: professorId, createdAt: current?.createdAt ?? new Date().toISOString(), className: teachingClass.name, caseTitle: clinicalCase.title };
    this.store.assignments.set(next.id, clone(next));
    return clone(next);
  }

  async listStudentOfferings(studentId: string): Promise<StudentCaseOffering[]> {
    const now = new Date().toISOString();
    const classes = [...this.store.classes.values()].filter((item) => item.members.some((member) => member.userId === studentId && member.role === "student"));
    return classes.flatMap((teachingClass): StudentCaseOffering[] => [...this.store.assignments.values()].filter((item) => item.classId === teachingClass.id).flatMap((assignment) => {
      const clinicalCase = this.store.cases.get(assignment.caseId);
      if (!clinicalCase || clinicalCase.status === "archived" || (clinicalCase as ClinicalCase & { isTestFixture?: boolean }).isTestFixture) return [];
      const existing = [...this.store.sessions.values()].find((item) => item.studentId === studentId && item.assignmentId === assignment.id);
      const offering: StudentCaseOffering = {
        assignment: clone(assignment),
        teachingClass: clone(teachingClass),
        case: clone(clinicalCase),
        existingSessionId: existing?.id ?? null,
        existingSessionStatus: existing?.status ?? null,
        existingSessionPausedAt: existing?.pausedAt ?? null,
        availability: assignment.status !== "open" || (assignment.dueAt && assignment.dueAt <= now) ? "closed" as const : assignment.opensAt > now ? "upcoming" as const : "open" as const,
      };
      return offering.availability === "open" || Boolean(offering.existingSessionId) ? [offering] : [];
    }));
  }

  async listSessionsForProfessor(professorId: string) {
    const classIds = new Set((await this.listClasses(professorId)).map((item) => item.id));
    const assignmentIds = new Set([...this.store.assignments.values()].filter((item) => classIds.has(item.classId)).map((item) => item.id));
    return Promise.all([...this.store.sessions.values()].filter((item) => item.assignmentId && assignmentIds.has(item.assignmentId)).map((item) => this.bundle(item, professorId)));
  }

  async getAdminOverview(): Promise<AdminOverview> {
    return { userCount: this.store.users.size, classCount: this.store.classes.size, openAssignmentCount: [...this.store.assignments.values()].filter((item) => item.status === "open").length, sessionCount: this.store.sessions.size, pendingReviewCount: [...this.store.sessions.values()].filter((item) => item.status === "completed" && item.reviewStatus !== "completed").length };
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

  private bundle(session: LearningSession, viewerId?: string): SessionBundle {
    const clinicalCase = this.store.cases.get(session.caseId);
    const student = this.store.users.get(session.studentId) ?? getDemoUser(session.studentId);
    if (!clinicalCase || !student) throw new Error("Seed relationship is invalid.");
    return clone({
      session,
      case: clinicalCase,
      student,
      answerReviews: session.evaluations
        .map((evaluation) => this.store.answerReviews.get(evaluation.id))
        .filter((review): review is AnswerReview => Boolean(review)),
      tutorTurnReviews: session.evaluations
        .map((evaluation) => this.store.tutorTurnReviews.get(evaluation.id))
        .filter((review): review is TutorTurnReview => Boolean(review)),
      sessionReview: this.store.sessionReviews.get(session.id) ?? null,
      runtime: { storage: "memory", tutor: "deterministic" },
      summaryGenerationStatus: session.status === "completed" && !session.summary ? "pending" as const : "ready" as const,
      assignment: session.assignmentId ? this.store.assignments.get(session.assignmentId) ?? null : null,
      teachingClass: this.classForAssignment(session.assignmentId) ?? null,
      reviewClaim: { reviewerId: session.reviewerId ?? null, reviewerName: session.reviewerId ? this.store.users.get(session.reviewerId)?.name ?? null : null, state: session.reviewStatus === "completed" ? "completed" : !session.reviewerId ? "unclaimed" : session.reviewerId === viewerId ? "mine" : "other", canEdit: session.reviewStatus !== "completed" && (!session.reviewerId || session.reviewerId === viewerId) },
    });
  }
}
