import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminOverview,
  AnswerReview,
  CaseAssignment,
  CasePhase,
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
import { CLASSIFICATION_SCORES } from "@/lib/domain";
import type { CommitTurnInput, SaveReviewInput, TutorRepository } from "@/lib/repository/types";
import { buildCaseVersionSlug, getCaseLineageId, getNextCaseVersion, getVersionedCaseTitle } from "@/lib/repository/case-version";
import { getTutorMode } from "@/lib/tutor";
import { reconcileLearnerStateEvidence } from "@/lib/tutor/learner-model";

type Row = Record<string, any>;

function must<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error || data === null) throw new Error(`${context}: ${error?.message ?? "no data"}`);
  return data;
}

export function mapPhase(row: Row): CasePhase {
  const questions = Array.isArray(row.questions) ? row.questions : [];
  const objectives = Array.isArray(row.objectives)
    ? row.objectives.filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const metadataRubric = Array.isArray(metadata.rubric)
    ? metadata.rubric.filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  const rubric = metadataRubric.length ? metadataRubric : objectives.slice(1);
  const goal = objectives[0] ?? row.teaching_notes ?? row.title;
  return {
    id: row.id,
    caseId: row.case_id,
    order: row.phase_order,
    title: row.title,
    goal,
    rubric: rubric.length ? rubric : [goal],
    starterQuestion: questions[0] ?? "What evidence supports your current reasoning?",
    exampleQuestions: questions.slice(1).length ? questions.slice(1) : questions,
    tutorGuidance: Array.isArray(metadata.tutorGuidance)
      ? metadata.tutorGuidance.filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()))
      : row.teaching_notes ? [row.teaching_notes] : [],
    tutorMoves: Array.isArray(metadata.tutorMoves) ? metadata.tutorMoves : [],
  };
}

function mapCase(row: Row, phases: Row[]): ClinicalCase {
  const mappedPhases = phases.map(mapPhase).sort((a, b) => a.order - b.order);
  return {
    id: row.id,
    title: row.title,
    description: row.presenting_complaint ?? "Clinical reasoning case",
    difficulty: "intermediate",
    status: row.status === "active" ? "available" : row.status === "archived" ? "archived" : "draft",
    learningObjectives: Array.isArray(row.tags) && row.tags.length
      ? row.tags.filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()))
      : mappedPhases.map((phase) => phase.goal),
    phases: mappedPhases,
    sourceCaseId: row.source_case_id ?? null,
    version: row.version ?? 1,
    publishedAt: row.published_at ?? null,
    attachments: Array.isArray(row.patient_context?.attachments) ? row.patient_context.attachments : [],
  };
}

function mapUser(row: Row): DemoUser {
  return { id: row.id, name: row.display_name, email: row.email, role: row.role, isActive: row.is_active !== false, profile: row.profile ?? {} };
}

function mapAssignment(row: Row): CaseAssignment {
  return { id: row.id, classId: row.class_id, caseId: row.case_id, assignedBy: row.assigned_by, status: row.status, opensAt: row.opens_at, dueAt: row.due_at, createdAt: row.created_at, className: row.classes?.name, caseTitle: row.cases?.title };
}

function mapMessage(row: Row): TutorMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    sender: row.role === "student" ? "student" : "ai",
    content: row.content,
    timestamp: row.created_at,
    replyToMessageId: row.metadata?.replyToMessageId,
  };
}

function mapEvaluation(row: Row): Evaluation {
  const criteria = row.criteria ?? {};
  return {
    id: row.id,
    messageId: row.message_id,
    classification: criteria.classification ?? "vague",
    confidence: Number(criteria.confidence ?? 0.5),
    reasoningGap: criteria.reasoningGap ?? "No reasoning gap recorded.",
    strategy: criteria.strategy ?? "probe",
    phaseComplete: Boolean(criteria.phaseComplete),
    feedback: criteria.feedback ?? row.feedback ?? "",
    phaseOrder: criteria.phaseOrder,
    attempt: criteria.attempt,
    provider: criteria.provider,
    fallbackFrom: criteria.fallbackFrom,
    model: criteria.model,
    promptVersion: criteria.promptVersion,
    createdAt: row.created_at,
  };
}

export class SupabaseTutorRepository implements TutorRepository {
  readonly mode = "supabase" as const;
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async listCases() {
    const { data, error } = await this.client.from("cases").select("*").eq("status", "active").order("created_at");
    const cases = must(data, error, "List cases");
    return Promise.all(
      cases.map(async (row) => {
        const phases = await this.getPhaseRows(row.id);
        return mapCase(row, phases);
      }),
    );
  }

  async getCase(caseId: string) {
    const { data, error } = await this.client.from("cases").select("*").eq("id", caseId).maybeSingle();
    if (error) throw new Error(`Get case: ${error.message}`);
    return data ? mapCase(data, await this.getPhaseRows(caseId)) : null;
  }

  async createSession(studentId: string, caseId: string, assignmentId?: string) {
    if (assignmentId) {
      const offerings = await this.listStudentOfferings(studentId);
      const offering = offerings.find((item) => item.assignment.id === assignmentId);
      if (!offering || offering.case.id !== caseId) throw new Error("This case assignment is not currently available.");
      if (offering.existingSessionId) return (await this.getSession(offering.existingSessionId))!;
      if (offering.availability !== "open") throw new Error("This case assignment is not currently available.");
    }
    const clinicalCase = await this.getCase(caseId);
    if (!clinicalCase) throw new Error("Case not found.");
    const firstPhase = clinicalCase.phases[0];
    const now = new Date().toISOString();
    const state: LearnerState = {
      sessionId: "",
      currentGoal: firstPhase.goal,
      previousErrors: [], strengths: [], weaknesses: [], nextStrategy: "probe",
      phaseAttempts: { "1": 0 },
      mastery: Object.fromEntries(clinicalCase.phases.map((phase) => [String(phase.order), 0])),
      usedTutorMoves: [],
      version: 1, updatedAt: now,
    };
    const { data: sessionData, error: sessionError } = await this.client
      .from("sessions")
      .insert({ case_id: caseId, student_id: studentId, class_case_assignment_id: assignmentId, current_phase_id: firstPhase.id, context: { reviewStatus: "pending" } })
      .select("id")
      .single();
    const session = must(sessionData, sessionError, "Create session");
    state.sessionId = session.id;
    const { error: stateError } = await this.client.from("session_state").insert({
      session_id: session.id, current_phase_id: firstPhase.id, state,
    });
    if (stateError) throw new Error(`Create learner state: ${stateError.message}`);
    const { error: messageError } = await this.client.from("messages").insert({
      session_id: session.id, role: "tutor", phase_id: firstPhase.id, sequence_no: 1,
      content: firstPhase.starterQuestion, metadata: { source: "socratic_tutor" },
    });
    if (messageError) throw new Error(`Create opening question: ${messageError.message}`);
    return (await this.getSession(session.id))!;
  }

  async getSession(sessionId: string): Promise<SessionBundle | null> {
    const { data: sessionRow, error } = await this.client.from("sessions").select("*").eq("id", sessionId).maybeSingle();
    if (error) throw new Error(`Get session: ${error.message}`);
    if (!sessionRow) return null;
    const [caseRowResult, phaseRows, userResult, messageResult, evaluationResult, stateResult, sessionReviewResult, tutorReviewResult] = await Promise.all([
      this.client.from("cases").select("*").eq("id", sessionRow.case_id).single(),
      this.getPhaseRows(sessionRow.case_id),
      this.client.from("users").select("*").eq("id", sessionRow.student_id).single(),
      this.client.from("messages").select("*").eq("session_id", sessionId).order("sequence_no"),
      this.client.from("evaluations").select("*").eq("session_id", sessionId).order("created_at"),
      this.client.from("session_state").select("*").eq("session_id", sessionId).single(),
      this.client.from("session_reviews").select("*").eq("session_id", sessionId).maybeSingle(),
      this.client.from("tutor_turn_reviews").select("*").eq("session_id", sessionId).order("created_at"),
    ]);
    const caseRow = must(caseRowResult.data, caseRowResult.error, "Get session case");
    const userRow = must(userResult.data, userResult.error, "Get session student");
    const messageRows = must(messageResult.data, messageResult.error, "Get messages");
    const evaluationRows = must(evaluationResult.data, evaluationResult.error, "Get evaluations");
    const stateRow = must(stateResult.data, stateResult.error, "Get learner state");
    const evaluations = evaluationRows.map(mapEvaluation);
    const context = sessionRow.context ?? {};
    const currentPhase = phaseRows.find((phase) => phase.id === sessionRow.current_phase_id)?.phase_order ?? 1;
    const learningSession: LearningSession = {
      id: sessionRow.id,
      studentId: sessionRow.student_id,
      caseId: sessionRow.case_id,
      currentPhase,
      status: sessionRow.status,
      reviewStatus: context.reviewStatus ?? (sessionReviewResult.data?.status === "approved" ? "completed" : "pending"),
      score: context.score ?? null,
      summary: (context.summary as SessionSummary | undefined) ?? null,
      createdAt: sessionRow.started_at,
      completedAt: sessionRow.ended_at,
      pausedAt: context.pausedAt ?? null,
      assignmentId: sessionRow.class_case_assignment_id ?? null,
      reviewerId: sessionRow.professor_id ?? null,
      messages: messageRows.map(mapMessage),
      evaluations,
      state: reconcileLearnerStateEvidence(stateRow.state as LearnerState),
    };
    const { data: reviewRows, error: reviewError } = await this.client
      .from("answer_reviews")
      .select("*")
      .in("message_id", evaluations.map((item) => item.messageId).length ? evaluations.map((item) => item.messageId) : [crypto.randomUUID()]);
    if (reviewError) throw new Error(`Get answer reviews: ${reviewError.message}`);
    const evaluationByMessage = new Map(evaluations.map((item) => [item.messageId, item]));
    const answerReviews: AnswerReview[] = (reviewRows ?? []).flatMap((row) => {
      const evaluation = evaluationByMessage.get(row.message_id);
      return evaluation ? [{
        evaluationId: evaluation.id,
        professorId: row.reviewer_id,
        label: row.rubric?.label ?? "vague",
        comments: row.comments ?? "",
        updatedAt: row.updated_at,
      }] : [];
    });
    const reviewRow = sessionReviewResult.data;
    const sessionReview: SessionReview | null = reviewRow ? {
      sessionId,
      professorId: reviewRow.reviewer_id,
      overallFeedback: reviewRow.summary ?? "",
      status: reviewRow.status === "approved" ? "completed" : "draft",
      finalScore: reviewRow.overall_score === null ? null : Number(reviewRow.overall_score),
      updatedAt: reviewRow.updated_at,
    } : null;
    const tutorTurnReviews: TutorTurnReview[] = must(
      tutorReviewResult.data,
      tutorReviewResult.error,
      "Get tutor turn reviews",
    ).map((row) => ({
      evaluationId: row.evaluation_id,
      tutorMessageId: row.tutor_message_id,
      professorId: row.reviewer_id,
      naturalness: row.naturalness,
      specificity: row.specificity,
      nonLeading: row.non_leading,
      challengeFit: row.challenge_fit,
      helpfulness: row.helpfulness,
      failureTags: row.failure_tags ?? [],
      preferredRewrite: row.preferred_rewrite ?? "",
      comments: row.comments ?? "",
      updatedAt: row.updated_at,
    }));
    let assignment: CaseAssignment | null = null;
    let teachingClass: TeachingClass | null = null;
    if (sessionRow.class_case_assignment_id) {
      const { data: assignmentRow } = await this.client.from("class_case_assignments").select("*, classes(name), cases(title)").eq("id", sessionRow.class_case_assignment_id).maybeSingle();
      if (assignmentRow) {
        assignment = mapAssignment(assignmentRow);
        teachingClass = (await this.listClasses()).find((item) => item.id === assignment!.classId) ?? null;
      }
    }
    return {
      session: learningSession,
      case: mapCase(caseRow, phaseRows),
      student: mapUser(userRow),
      answerReviews,
      tutorTurnReviews,
      sessionReview,
      runtime: {
        storage: "supabase",
        tutor: getTutorMode(),
        fallbackFrom: evaluations.at(-1)?.fallbackFrom,
      },
      assignment,
      teachingClass,
      reviewClaim: { reviewerId: sessionRow.professor_id ?? null, reviewerName: sessionRow.professor_id ? (await this.listUsers()).find((item) => item.id === sessionRow.professor_id)?.name ?? null : null, state: sessionReview?.status === "completed" ? "completed" : sessionRow.professor_id ? "other" : "unclaimed", canEdit: !sessionRow.professor_id && sessionReview?.status !== "completed" },
    };
  }

  async commitTurn(input: CommitTurnInput) {
    const bundle = await this.getSession(input.sessionId);
    if (!bundle) throw new Error("Session not found.");
    const phase = bundle.case.phases.find((item) => item.order === bundle.session.currentPhase)!;
    const nextPhase = bundle.case.phases.find((item) => item.order === input.nextPhase)!;
    const context = { score: input.score, summary: input.summary, reviewStatus: bundle.session.reviewStatus, pausedAt: null };
    const { error } = await this.client.rpc("commit_tutor_turn", {
      p_session_id: input.sessionId,
      p_student_sender_id: bundle.session.studentId,
      p_student_content: input.studentMessage.content,
      p_student_phase_id: phase.id,
      p_ai_content: input.aiMessage.content,
      p_ai_phase_id: nextPhase.id,
      p_evaluation_type: "formative",
      p_evaluation_score: CLASSIFICATION_SCORES[input.evaluation.classification],
      p_evaluation_criteria: {
        classification: input.evaluation.classification,
        confidence: input.evaluation.confidence,
        reasoningGap: input.evaluation.reasoningGap,
        strategy: input.evaluation.strategy,
        phaseComplete: input.evaluation.phaseComplete,
        feedback: input.evaluation.feedback,
        phaseOrder: input.evaluation.phaseOrder,
        attempt: input.evaluation.attempt,
        provider: input.evaluation.provider,
        fallbackFrom: input.evaluation.fallbackFrom,
        model: input.evaluation.model,
        promptVersion: input.evaluation.promptVersion,
      },
      p_evaluation_feedback: input.evaluation.feedback,
      p_evaluator_id: null,
      p_state: input.nextState,
      p_expected_version: input.expectedVersion,
      p_session_context: context,
      p_facts: input.nextState.strengths,
      p_unresolved_questions: input.nextState.previousErrors,
      p_current_phase_id: nextPhase.id,
      p_session_status: input.status,
    });
    if (error) throw new Error(`Commit tutor turn: ${error.message}`);
    return (await this.getSession(input.sessionId))!;
  }

  async completeSession(sessionId: string, summary: SessionSummary, completedAt: string) {
    const current = await this.getSession(sessionId);
    if (!current) throw new Error("Session not found.");
    const { error } = await this.client.from("sessions").update({
      status: "completed", ended_at: completedAt,
      context: { score: summary.overallScore, summary, reviewStatus: current.session.reviewStatus, pausedAt: null },
    }).eq("id", sessionId);
    if (error) throw new Error(`Complete session: ${error.message}`);
    return (await this.getSession(sessionId))!;
  }

  async setSessionPaused(sessionId: string, pausedAt: string | null) {
    const { data, error } = await this.client.from("sessions").select("status, context").eq("id", sessionId).maybeSingle();
    if (error) throw new Error(`Read session pause state: ${error.message}`);
    if (!data) throw new Error("Session not found.");
    if (data.status !== "active") throw new Error("Completed sessions cannot be paused or resumed.");
    const { error: updateError } = await this.client.from("sessions").update({
      context: { ...(data.context ?? {}), pausedAt },
    }).eq("id", sessionId);
    if (updateError) throw new Error(`Update session pause state: ${updateError.message}`);
    return (await this.getSession(sessionId))!;
  }

  async listSessions() {
    const { data, error } = await this.client.from("sessions").select("id").order("created_at", { ascending: false });
    const rows = must(data, error, "List sessions");
    return Promise.all(rows.map(async (row) => (await this.getSession(row.id))!));
  }

  async saveReview(input: SaveReviewInput) {
    const bundle = await this.getSession(input.sessionId);
    if (!bundle) throw new Error("Session not found.");
    if (bundle.session.status !== "completed") throw new Error("Only completed sessions can be reviewed.");
    if (!bundle.assignment || !(await this.listClasses(input.professorId)).some((item) => item.id === bundle.assignment!.classId)) throw new Error("This review is outside the professor's classes.");
    if (bundle.session.reviewerId && bundle.session.reviewerId !== input.professorId) throw new Error("Review already claimed by another professor.");
    const evaluationMap = new Map(bundle.session.evaluations.map((item) => [item.id, item]));
    const tutorMessageIds = new Set(bundle.session.messages.filter((message) => message.sender === "ai").map((message) => message.id));
    for (const review of input.reviews) {
      if (!evaluationMap.has(review.evaluationId)) throw new Error("Review references an answer outside this session.");
    }
    for (const review of input.tutorReviews ?? []) {
      const evaluation = evaluationMap.get(review.evaluationId);
      if (!evaluation || !tutorMessageIds.has(review.tutorMessageId)) {
        throw new Error("Tutor review references a turn outside this session.");
      }
      const studentMessageIndex = bundle.session.messages.findIndex((message) => message.id === evaluation.messageId);
      const expectedTutorMessage = bundle.session.messages.slice(studentMessageIndex + 1).find((message) => message.sender === "ai");
      if (expectedTutorMessage?.id !== review.tutorMessageId) {
        throw new Error("Tutor review does not match the evaluated answer.");
      }
    }
    if (!bundle.session.reviewerId) {
      const { data: claimed, error: claimError } = await this.client.from("sessions").update({ professor_id: input.professorId }).eq("id", input.sessionId).is("professor_id", null).select("id");
      if (claimError) throw new Error(`Claim review: ${claimError.message}`);
      if (!claimed?.length) throw new Error("Review already claimed by another professor.");
    }
    for (const review of input.reviews) {
      const evaluation = evaluationMap.get(review.evaluationId)!;
      const { error } = await this.client.from("answer_reviews").upsert({
        message_id: evaluation.messageId,
        reviewer_id: input.professorId,
        status: input.status === "completed" ? "approved" : "pending",
        score: CLASSIFICATION_SCORES[review.label],
        comments: review.comments,
        rubric: { label: review.label, evaluationId: review.evaluationId },
      }, { onConflict: "message_id,reviewer_id" });
      if (error) throw new Error(`Save answer review: ${error.message}`);
    }
    for (const review of input.tutorReviews ?? []) {
      const { error } = await this.client.from("tutor_turn_reviews").upsert({
        session_id: input.sessionId,
        evaluation_id: review.evaluationId,
        tutor_message_id: review.tutorMessageId,
        reviewer_id: input.professorId,
        naturalness: review.naturalness,
        specificity: review.specificity,
        non_leading: review.nonLeading,
        challenge_fit: review.challengeFit,
        helpfulness: review.helpfulness,
        failure_tags: review.failureTags,
        preferred_rewrite: review.preferredRewrite || null,
        comments: review.comments || null,
      }, { onConflict: "evaluation_id" });
      if (error) throw new Error(`Save tutor turn review: ${error.message}`);
    }
    const finalScore = input.reviews.length
      ? Math.round(input.reviews.reduce((sum, item) => sum + CLASSIFICATION_SCORES[item.label], 0) / input.reviews.length)
      : null;
    const { error: sessionReviewError } = await this.client.from("session_reviews").upsert({
      session_id: input.sessionId,
      reviewer_id: input.professorId,
      status: input.status === "completed" ? "approved" : "pending",
      overall_score: finalScore,
      summary: input.overallFeedback,
      rubric: { workflowStatus: input.status },
    }, { onConflict: "session_id,reviewer_id" });
    if (sessionReviewError) throw new Error(`Save session review: ${sessionReviewError.message}`);
    const { error: sessionError } = await this.client.from("sessions").update({
      context: {
        score: bundle.session.score,
        summary: bundle.session.summary,
        reviewStatus: input.status === "completed" ? "completed" : "in_review",
      },
    }).eq("id", input.sessionId);
    if (sessionError) throw new Error(`Update review status: ${sessionError.message}`);
    return (await this.getSession(input.sessionId))!;
  }

  private async getPhaseRows(caseId: string) {
    const { data, error } = await this.client.from("case_phases").select("*").eq("case_id", caseId).order("phase_order");
    return must(data, error, "Get case phases");
  }

  async listUsers() {
    const { data, error } = await this.client.from("users").select("*").order("display_name");
    return must(data, error, "List users").map(mapUser);
  }

  async updateUser(userId: string, patch: Partial<Pick<DemoUser, "name" | "email" | "isActive">>) {
    const { data, error } = await this.client.from("users").update({ ...(patch.name === undefined ? {} : { display_name: patch.name }), ...(patch.email === undefined ? {} : { email: patch.email }), ...(patch.isActive === undefined ? {} : { is_active: patch.isActive }) }).eq("id", userId).select("*").single();
    return mapUser(must(data, error, "Update user"));
  }

  async listClasses(userId?: string): Promise<TeachingClass[]> {
    const query = this.client.from("classes").select("*").order("created_at");
    const { data, error } = await query;
    const rows = must(data, error, "List classes");
    const result = await Promise.all(rows.map(async (row) => {
      const { data: members, error: memberError } = await this.client.from("class_memberships").select("*, users(*)").eq("class_id", row.id);
      const mapped: ClassMembership[] = must(members, memberError, "List class members").map((member) => ({ classId: member.class_id, userId: member.user_id, role: member.role, isLead: member.is_lead, user: member.users ? mapUser(member.users) : undefined }));
      return { id: row.id, name: row.name, code: row.code, term: row.term, status: row.status, createdBy: row.created_by, createdAt: row.created_at, members: mapped } as TeachingClass;
    }));
    return userId ? result.filter((item) => item.members.some((member) => member.userId === userId)) : result;
  }

  async saveClass(input: Omit<TeachingClass, "id" | "createdAt" | "members"> & { id?: string }) {
    const payload = { name: input.name, code: input.code, term: input.term, status: input.status, created_by: input.createdBy };
    const operation = input.id ? this.client.from("classes").update(payload).eq("id", input.id).select("id").single() : this.client.from("classes").insert(payload).select("id").single();
    const { data, error } = await operation;
    const id = must(data, error, "Save class").id;
    return (await this.listClasses()).find((item) => item.id === id)!;
  }

  async setClassMembers(classId: string, members: ClassMembership[]) {
    if (!members.some((item) => item.role === "professor" && item.isLead)) throw new Error("A lead professor is required.");
    const { error: deleteError } = await this.client.from("class_memberships").delete().eq("class_id", classId);
    if (deleteError) throw new Error(`Replace class members: ${deleteError.message}`);
    const { error } = await this.client.from("class_memberships").insert(members.map((item) => ({ class_id: classId, user_id: item.userId, role: item.role, is_lead: item.isLead })));
    if (error) throw new Error(`Save class members: ${error.message}`);
    return (await this.listClasses()).find((item) => item.id === classId)!;
  }

  async listCaseVersions() {
    const { data, error } = await this.client.from("cases").select("*").order("created_at");
    return Promise.all(must(data, error, "List case versions").map(async (row) => mapCase(row, await this.getPhaseRows(row.id))));
  }

  async saveCase(input: ClinicalCase, adminId: string) {
    const existing = input.id ? await this.getCase(input.id) : null;
    if (existing && existing.status !== "draft") throw new Error("Published cases are immutable. Clone a new version.");
    const caseId = input.id || crypto.randomUUID();
    const version = input.version ?? 1;
    let existingPatientContext: Record<string, unknown> = {};
    if (input.id) {
      const { data: existingRow, error: existingRowError } = await this.client
        .from("cases")
        .select("patient_context")
        .eq("id", input.id)
        .maybeSingle();
      if (existingRowError) throw new Error(`Read case patient context: ${existingRowError.message}`);
      if (existingRow?.patient_context && typeof existingRow.patient_context === "object") {
        existingPatientContext = existingRow.patient_context;
      }
    }
    const payload = { title: input.title, slug: buildCaseVersionSlug(input.title, version, caseId), specialty: "dentistry", presenting_complaint: input.description, status: "draft", created_by: adminId, source_case_id: input.sourceCaseId ?? null, version, published_at: null, patient_context: { ...existingPatientContext, attachments: input.attachments ?? [] }, tags: input.learningObjectives };
    const operation = input.id ? this.client.from("cases").update(payload).eq("id", input.id).select("id").single() : this.client.from("cases").insert({ id: caseId, ...payload }).select("id").single();
    const { data, error } = await operation;
    const savedCaseId = must(data, error, "Save case").id;
    if (input.id) await this.client.from("case_phases").delete().eq("case_id", savedCaseId);
    const { error: phaseError } = await this.client.from("case_phases").insert(input.phases.map((phase, index) => ({
      case_id: savedCaseId,
      phase_order: index + 1,
      phase_key: `phase_${index + 1}`,
      title: phase.title,
      objectives: [phase.goal, ...phase.rubric],
      questions: [phase.starterQuestion, ...phase.exampleQuestions],
      teaching_notes: phase.tutorGuidance?.join("\n") || phase.goal,
      expected_findings: {},
      metadata: {
        rubric: phase.rubric,
        tutorGuidance: phase.tutorGuidance ?? [],
        tutorMoves: phase.tutorMoves ?? [],
      },
    })));
    if (phaseError) throw new Error(`Save case phases: ${phaseError.message}`);
    return (await this.listCaseVersions()).find((item) => item.id === savedCaseId)!;
  }

  async publishCase(caseId: string) {
    const { error } = await this.client.from("cases").update({ status: "active", published_at: new Date().toISOString() }).eq("id", caseId);
    if (error) throw new Error(`Publish case: ${error.message}`);
    return (await this.getCase(caseId))!;
  }

  async archiveCase(caseId: string) {
    const { error } = await this.client.from("cases").update({ status: "archived" }).eq("id", caseId);
    if (error) throw new Error(`Archive case: ${error.message}`);
    return (await this.getCase(caseId))!;
  }

  async cloneCase(caseId: string, adminId: string) {
    const source = await this.getCase(caseId);
    if (!source) throw new Error("Case not found.");
    const version = getNextCaseVersion(await this.listCaseVersions(), source);
    return this.saveCase({ ...source, id: "", title: getVersionedCaseTitle(source.title, version), status: "draft", sourceCaseId: getCaseLineageId(source), version, publishedAt: null, phases: source.phases.map((phase) => ({ ...phase, id: "" })) }, adminId);
  }

  async listAssignments(professorId?: string) {
    const allowedClassIds = professorId ? new Set((await this.listClasses(professorId)).map((item) => item.id)) : null;
    const { data, error } = await this.client.from("class_case_assignments").select("*, classes(name), cases(title)").order("created_at", { ascending: false });
    return must(data, error, "List assignments").map(mapAssignment).filter((item) => !allowedClassIds || allowedClassIds.has(item.classId));
  }

  async saveAssignment(input: Omit<CaseAssignment, "id" | "createdAt" | "assignedBy"> & { id?: string }, professorId: string) {
    if (!(await this.listClasses(professorId)).some((item) => item.id === input.classId)) throw new Error("Professor is outside this class.");
    const clinicalCase = await this.getCase(input.caseId);
    if (!clinicalCase || clinicalCase.status !== "available") throw new Error("Only published cases can be assigned.");
    const payload = { class_id: input.classId, case_id: input.caseId, assigned_by: professorId, status: input.status, opens_at: input.opensAt, due_at: input.dueAt };
    const operation = input.id ? this.client.from("class_case_assignments").update(payload).eq("id", input.id).select("id").single() : this.client.from("class_case_assignments").insert(payload).select("id").single();
    const { data, error } = await operation;
    const id = must(data, error, "Save assignment").id;
    return (await this.listAssignments(professorId)).find((item) => item.id === id)!;
  }

  async listStudentOfferings(studentId: string): Promise<StudentCaseOffering[]> {
    const classIds = new Set((await this.listClasses(studentId)).map((item) => item.id));
    const assignments = (await this.listAssignments()).filter((item) => classIds.has(item.classId));
    const classes = await this.listClasses();
    const sessions = await this.listSessions();
    const now = new Date().toISOString();
    const offerings = await Promise.all(assignments.map(async (assignment): Promise<StudentCaseOffering> => {
      const existing = sessions.find((item) => item.session.studentId === studentId && item.session.assignmentId === assignment.id)?.session;
      return {
        assignment,
        teachingClass: classes.find((item) => item.id === assignment.classId)!,
        case: (await this.getCase(assignment.caseId))!,
        existingSessionId: existing?.id ?? null,
        existingSessionStatus: existing?.status ?? null,
        existingSessionPausedAt: existing?.pausedAt ?? null,
        availability: assignment.status !== "open" || (assignment.dueAt && assignment.dueAt <= now) ? "closed" : assignment.opensAt > now ? "upcoming" : "open",
      };
    }));
    return offerings.filter((offering) => offering.availability === "open" || Boolean(offering.existingSessionId));
  }

  async listSessionsForProfessor(professorId: string): Promise<SessionBundle[]> {
    const assignmentIds = new Set((await this.listAssignments(professorId)).map((item) => item.id));
    const sessions = (await this.listSessions()).filter((item) => item.session.assignmentId && assignmentIds.has(item.session.assignmentId));
    const users = await this.listUsers();
    return sessions.map((bundle) => ({ ...bundle, reviewClaim: { reviewerId: bundle.session.reviewerId ?? null, reviewerName: bundle.session.reviewerId ? users.find((item) => item.id === bundle.session.reviewerId)?.name ?? null : null, state: bundle.session.reviewStatus === "completed" ? "completed" as const : !bundle.session.reviewerId ? "unclaimed" as const : bundle.session.reviewerId === professorId ? "mine" as const : "other" as const, canEdit: bundle.session.reviewStatus !== "completed" && (!bundle.session.reviewerId || bundle.session.reviewerId === professorId) } }));
  }

  async getAdminOverview(): Promise<AdminOverview> {
    const [users, classes, assignments, sessions] = await Promise.all([this.listUsers(), this.listClasses(), this.listAssignments(), this.listSessions()]);
    return { userCount: users.length, classCount: classes.length, openAssignmentCount: assignments.filter((item) => item.status === "open").length, sessionCount: sessions.length, pendingReviewCount: sessions.filter((item) => item.session.status === "completed" && item.session.reviewStatus !== "completed").length };
  }

  async reassignReview(sessionId: string, professorId: string | null) {
    const current = await this.getSession(sessionId);
    if (!current) throw new Error("Session not found.");
    if (current.session.reviewStatus === "completed") throw new Error("Completed reviews cannot be reassigned.");
    const { error } = await this.client.from("sessions").update({ professor_id: professorId }).eq("id", sessionId);
    if (error) throw new Error(`Reassign review: ${error.message}`);
    return (await this.getSession(sessionId))!;
  }
}
