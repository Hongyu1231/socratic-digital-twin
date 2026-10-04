import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminOverview,
  AnswerReview,
  CaseAssignment,
  CasePhase,
  ClassMembership,
  ClinicalCase,
  ClinicalFinding,
  DemoUser,
  Evaluation,
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
  RubricCriterion,
} from "@/lib/domain";
import { CLASSIFICATION_SCORES } from "@/lib/domain";
import { ArchivedCaseError, AssignmentIdempotencyConflictError, IdempotencyConflictError, SupersededCaseError, type CommitTurnInput, type SaveReviewInput, type TutorRepository } from "@/lib/repository/types";
import { buildCaseVersionSlug, getCaseLineageId, getNextCaseVersion, getVersionedCaseTitle } from "@/lib/repository/case-version";
import { buildEvaluationCriteria, readCriteriaMet, readMisconceptionKey } from "@/lib/repository/evaluation-criteria";
import {
  inspectStoredAttachments,
  normalizeWritableAttachments,
  reportAttachmentDiagnostics,
  type CaseAttachmentDiagnostic,
} from "@/lib/repository/case-attachments";
import { assertCaseStatusTransition } from "@/lib/repository/case-status";
import { getTutorMode } from "@/lib/tutor";
import { reconcileLearnerStateEvidence } from "@/lib/tutor/learner-model";
import { rubricCriterionSchema } from "@/lib/schemas";
import {
  decodeStaffSessionCursor,
  encodeStaffSessionCursor,
  normalizeStaffSessionLimit,
  staffReviewState,
} from "@/lib/repository/staff-session";

type Row = Record<string, any>;
const HOSTED_PACKAGE_ID = /^[a-f0-9]{64}$/i;
const CRITERION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

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
  const metadataRubric: Array<string | RubricCriterion> = Array.isArray(metadata.rubric)
    ? metadata.rubric.flatMap((item: unknown) => {
      if (typeof item === "string" && item.trim()) return [item.trim()];
      const parsed = rubricCriterionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
    : [];
  const rubric = metadataRubric.length ? metadataRubric : objectives.slice(1);
  const goal = objectives[0] ?? row.teaching_notes ?? row.title;
  const resolvedRubric = rubric.length ? rubric : [goal];
  const requiredCriterionIds = new Set(resolvedRubric.map((criterion, index) =>
    typeof criterion === "string" ? `r${index + 1}` : criterion.id,
  ));
  const acceptedExtras = Array.isArray(metadata.acceptedExtras) && metadata.acceptedExtras.length <= 32
    ? (() => {
      const seen = new Set<string>();
      const normalized = metadata.acceptedExtras.flatMap((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const extra = item as Record<string, unknown>;
        if (Object.keys(extra).some((key) => key !== "id" && key !== "text")) return [];
        if (typeof extra.id !== "string" || !extra.id.trim()
          || typeof extra.text !== "string" || !extra.text.trim()) return [];
        const id = extra.id.trim();
        const text = extra.text.trim();
        if (id.length > 100 || !CRITERION_ID_RE.test(id) || text.length > 500) return [];
        if (requiredCriterionIds.has(id) || seen.has(id)) return [];
        seen.add(id);
        return [{ id, text }];
      });
      return normalized.length === metadata.acceptedExtras.length ? normalized : [];
    })()
    : [];
  const rawNoProgressLimit = metadata.noProgressLimit ?? metadata.no_progress_limit;
  const rawPhaseCeiling = metadata.phaseCeiling ?? metadata.phase_ceiling;
  return {
    id: row.id,
    caseId: row.case_id,
    order: row.phase_order,
    title: row.title,
    goal,
    rubric: resolvedRubric,
    acceptedExtras,
    starterQuestion: questions[0] ?? "What evidence supports your current reasoning?",
    exampleQuestions: questions.slice(1).length ? questions.slice(1) : questions,
    tutorGuidance: Array.isArray(metadata.tutorGuidance)
      ? metadata.tutorGuidance.filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()))
      : row.teaching_notes ? [row.teaching_notes] : [],
    tutorMoves: Array.isArray(metadata.tutorMoves) ? metadata.tutorMoves : [],
    ...(typeof rawNoProgressLimit === "number" && Number.isInteger(rawNoProgressLimit) && rawNoProgressLimit > 0
      ? { noProgressLimit: rawNoProgressLimit }
      : {}),
    ...(typeof rawPhaseCeiling === "number" && Number.isInteger(rawPhaseCeiling) && rawPhaseCeiling > 1
      ? { phaseCeiling: rawPhaseCeiling }
      : {}),
  };
}

function mapTeachingMaterialPackageId(row: Row): string | undefined {
  const patientContext = row.patient_context && typeof row.patient_context === "object" && !Array.isArray(row.patient_context)
    ? row.patient_context as Record<string, unknown>
    : {};
  const raw = patientContext.teachingMaterialPackageId;
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !HOSTED_PACKAGE_ID.test(raw.trim())) {
    throw new Error("Case teaching-material reference is invalid.");
  }
  return raw.trim().toLowerCase();
}

export function mapCaseWithDiagnostics(row: Row, phases: Row[]): { case: ClinicalCase; diagnostics: CaseAttachmentDiagnostic[] } {
  const mappedPhases = phases.map(mapPhase).sort((a, b) => a.order - b.order);
  const rawAttachments = row.attachments !== undefined && row.attachments !== null
    ? row.attachments
    : row.patient_context?.attachments;
  const attachmentInspection = inspectStoredAttachments(String(row.id), rawAttachments, mappedPhases.map((phase) => phase.order));
  reportAttachmentDiagnostics(attachmentInspection.diagnostics);
  const teachingMaterialPackageId = mapTeachingMaterialPackageId(row);
  const patientContext = row.patient_context && typeof row.patient_context === "object" && !Array.isArray(row.patient_context)
    ? row.patient_context as Record<string, unknown>
    : {};
  const findings: ClinicalFinding[] = Array.isArray(patientContext.findings)
    ? patientContext.findings.flatMap((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const finding = value as Record<string, unknown>;
      if (typeof finding.id !== "string" || !finding.id.trim() || typeof finding.title !== "string" || !finding.title.trim() || typeof finding.text !== "string" || !finding.text.trim()) return [];
      const unlockPhase = typeof finding.unlockPhase === "number" && Number.isInteger(finding.unlockPhase) && finding.unlockPhase > 0
        ? finding.unlockPhase
        : 1;
      return [{
        id: finding.id,
        title: finding.title,
        text: finding.text,
        unlockPhase,
        ...(finding.unlockOnRequest === false ? { unlockOnRequest: false as const } : {}),
      }];
    })
    : [];
  const correctionProbes = patientContext.correctionProbes === 1 || patientContext.correctionProbes === 2
    ? patientContext.correctionProbes
    : undefined;
  const difficulty = row.difficulty === "foundation" || row.difficulty === "advanced" || row.difficulty === "intermediate"
    ? row.difficulty
    : "intermediate";
  const caseValue: ClinicalCase = {
    id: row.id,
    title: row.title,
    description: row.presenting_complaint ?? "Clinical reasoning case",
    difficulty,
    status: row.status === "active" ? "available" : row.status === "archived" ? "archived" : row.status === "superseded" ? "superseded" : "draft",
    learningObjectives: Array.isArray(row.tags) && row.tags.length
      ? row.tags.filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()))
      : mappedPhases.map((phase) => phase.goal),
    phases: mappedPhases,
    sourceCaseId: row.source_case_id ?? null,
    version: row.version ?? 1,
    publishedAt: row.published_at ?? null,
    attachments: attachmentInspection.valid,
    findings,
    ...(correctionProbes ? { correctionProbes } : {}),
    isTestFixture: row.is_test_fixture === true,
    ...(teachingMaterialPackageId ? { teachingMaterialPackageId } : {}),
  };
  return { case: caseValue, diagnostics: attachmentInspection.diagnostics };
}

export function mapCase(row: Row, phases: Row[]): ClinicalCase {
  return mapCaseWithDiagnostics(row, phases).case;
}

function mapUser(row: Row): DemoUser {
  return { id: row.id, name: row.display_name, email: row.email, role: row.role, isActive: row.is_active !== false, profile: row.profile ?? {} };
}

function mapAssignment(row: Row): CaseAssignment {
  return { id: row.id, classId: row.class_id, caseId: row.case_id, assignedBy: row.assigned_by, status: row.status, opensAt: row.opens_at, dueAt: row.due_at, createdAt: row.created_at, idempotencyKey: row.idempotency_key ?? null, className: row.classes?.name, caseTitle: row.cases?.title };
}

function normalizeAssignmentTime(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function sameAssignmentRequest(
  current: Row,
  input: Omit<CaseAssignment, "id" | "createdAt" | "assignedBy"> & { id?: string },
) {
  return current.class_id === input.classId
    && current.case_id === input.caseId
    && current.status === input.status
    && normalizeAssignmentTime(current.opens_at) === normalizeAssignmentTime(input.opensAt)
    && normalizeAssignmentTime(current.due_at) === normalizeAssignmentTime(input.dueAt);
}

function assignmentConflict(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "23505" || /idempotency_key|class_case_assignments_idempotency/i.test(error.message ?? "")));
}

function staffSessionReviewStatus(row: Row): "pending" | "in_review" | "completed" {
  const context = row.context && typeof row.context === "object" && !Array.isArray(row.context) ? row.context as Row : {};
  if (context.reviewStatus === "completed") return "completed";
  if (context.reviewStatus === "in_review") return "in_review";
  const review = Array.isArray(row.session_reviews) ? row.session_reviews[0] : row.session_reviews;
  return review?.status === "approved" ? "completed" : "pending";
}

function staffSessionFromRow(row: Row): Pick<LearningSession, "id" | "caseId" | "studentId" | "assignmentId" | "status" | "reviewStatus" | "score" | "createdAt" | "completedAt" | "reviewerId"> {
  const context = row.context && typeof row.context === "object" && !Array.isArray(row.context) ? row.context as Row : {};
  const rawScore = context.score;
  return {
    id: row.id,
    caseId: row.case_id,
    studentId: row.student_id,
    assignmentId: row.class_case_assignment_id ?? null,
    status: row.status,
    reviewStatus: staffSessionReviewStatus(row),
    score: typeof rawScore === "number" ? rawScore : rawScore === null || rawScore === undefined ? null : Number(rawScore),
    createdAt: row.created_at ?? row.started_at,
    completedAt: row.ended_at ?? null,
    reviewerId: row.professor_id ?? null,
  };
}

function mapClass(row: Row, memberRows: Row[]): TeachingClass {
  const members: ClassMembership[] = memberRows.map((member) => ({
    classId: member.class_id,
    userId: member.user_id,
    role: member.role,
    isLead: member.is_lead,
    user: member.users ? mapUser(member.users) : undefined,
  }));
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    term: row.term,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    members,
  };
}

type SummaryGenerationStatus = "pending" | "ready" | "failed";

function summaryGenerationStatus(sessionRow: Row, context: Row, jobRow: Row | null): SummaryGenerationStatus {
  const explicit = context.summaryGenerationStatus ?? context.summary_generation_status;
  if (explicit === "pending" || explicit === "ready" || explicit === "failed") return explicit;
  if (sessionRow.summary_generation_status === "pending" || sessionRow.summary_generation_status === "ready" || sessionRow.summary_generation_status === "failed") {
    return sessionRow.summary_generation_status;
  }
  if (sessionRow.status !== "completed") return "ready";
  switch (jobRow?.status) {
    case "failed":
      return "failed";
    case "completed":
    case "succeeded":
    case "ready":
      return "ready";
    case "pending":
    case "queued":
    case "processing":
    case "retrying":
      return "pending";
    default:
      return context.summary ? "ready" : "pending";
  }
}

function mapMessage(row: Row): TutorMessage {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  const acknowledgement = typeof metadata.acknowledgement === "string" ? metadata.acknowledgement : undefined;
  const moveType = ["question", "hypothetical", "reveal", "correction", "transition", "reflection"].includes(String(metadata.moveType))
    ? metadata.moveType as TutorMessage["moveType"]
    : undefined;
  return {
    id: row.id,
    sessionId: row.session_id,
    sender: row.role === "student" ? "student" : "ai",
    content: row.content,
    timestamp: row.created_at,
    replyToMessageId: typeof metadata.replyToMessageId === "string" ? metadata.replyToMessageId : undefined,
    ...(acknowledgement ? { acknowledgement } : {}),
    ...(moveType ? { moveType } : {}),
  };
}

export function mapEvaluation(row: Row): Evaluation {
  const criteria = row.criteria ?? {};
  const retrieval = mapRetrieval(criteria.retrieval);
  return {
    id: row.id,
    messageId: row.message_id,
    classification: criteria.classification ?? "vague",
    confidence: Number(criteria.confidence ?? 0.5),
    reasoningGap: criteria.reasoningGap ?? "No reasoning gap recorded.",
    misconceptionKey: readMisconceptionKey(criteria),
    strategy: criteria.strategy ?? "probe",
    phaseComplete: Boolean(criteria.phaseComplete),
    feedback: criteria.feedback ?? row.feedback ?? "",
    phaseOrder: criteria.phaseOrder,
    attempt: criteria.attempt,
    provider: criteria.provider,
    fallbackFrom: criteria.fallbackFrom,
    model: criteria.model,
    promptVersion: criteria.promptVersion,
    targetCriterionId: typeof criteria.targetCriterionId === "string" && criteria.targetCriterionId.length > 0
      ? criteria.targetCriterionId
      : undefined,
    answerCriterionId: typeof criteria.answerCriterionId === "string" && criteria.answerCriterionId.length > 0
      ? criteria.answerCriterionId
      : null,
    criteriaMet: readCriteriaMet(criteria),
    supportLevel: criteria.supportLevel === 0 || criteria.supportLevel === 1 || criteria.supportLevel === 2
      ? criteria.supportLevel
      : undefined,
    completedWithSupport: typeof criteria.completedWithSupport === "boolean" ? criteria.completedWithSupport : undefined,
    isReflection: typeof criteria.isReflection === "boolean" ? criteria.isReflection : undefined,
    ...(retrieval ? { retrieval } : {}),
    createdAt: row.created_at,
  };
}

function mapRetrieval(value: unknown): Evaluation["retrieval"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.query !== "string" || !Array.isArray(raw.passages)) return undefined;
  const passages = raw.passages.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const passage = item as Record<string, unknown>;
    if (typeof passage.sourceId !== "string" || typeof passage.page !== "number" || typeof passage.score !== "number") return [];
    return [{
      sourceId: passage.sourceId,
      page: passage.page,
      ...(typeof passage.locator === "string" ? { locator: passage.locator } : {}),
      score: passage.score,
    }];
  });
  return { query: raw.query, passages };
}

function buildMessageMetadata(message: TutorMessage, source: "student" | "socratic_tutor") {
  return {
    source,
    ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
    ...(message.acknowledgement ? { acknowledgement: message.acknowledgement } : {}),
    ...(message.moveType ? { moveType: message.moveType } : {}),
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
    const result = await this.readCaseWithDiagnostics(caseId);
    return result?.case ?? null;
  }

  private async readCaseWithDiagnostics(caseId: string): Promise<{ row: Row; case: ClinicalCase; diagnostics: CaseAttachmentDiagnostic[] } | null> {
    const { data, error } = await this.client.from("cases").select("*").eq("id", caseId).maybeSingle();
    if (error) throw new Error(`Get case: ${error.message}`);
    if (!data) return null;
    const mapped = mapCaseWithDiagnostics(data, await this.getPhaseRows(caseId));
    return { row: data, ...mapped };
  }

  async createSession(studentId: string, caseId: string, assignmentId?: string) {
    let assignmentRow: Row | null = null;
    if (assignmentId) {
      assignmentRow = await this.getStudentAssignment(studentId, assignmentId);
      if (!assignmentRow || assignmentRow.case_id !== caseId) throw new Error("This case assignment is not currently available.");
    }
    return this.createSessionFromCase(studentId, caseId, assignmentId, assignmentRow);
  }

  async createSessionForAssignment(studentId: string, assignmentId: string) {
    const assignmentRow = await this.getStudentAssignment(studentId, assignmentId);
    if (!assignmentRow) throw new Error("This case assignment is not available to you.");
    return this.createSessionFromCase(studentId, assignmentRow.case_id, assignmentId, assignmentRow);
  }

  private async getStudentAssignment(studentId: string, assignmentId: string): Promise<Row | null> {
    const { data: assignment, error: assignmentError } = await this.client
      .from("class_case_assignments")
      .select("*, cases(*)")
      .eq("id", assignmentId)
      .maybeSingle();
    if (assignmentError) throw new Error(`Get case assignment: ${assignmentError.message}`);
    if (!assignment) return null;
    const { data: membership, error: membershipError } = await this.client
      .from("class_memberships")
      .select("class_id")
      .eq("class_id", assignment.class_id)
      .eq("user_id", studentId)
      .eq("role", "student")
      .maybeSingle();
    if (membershipError) throw new Error(`Check case assignment membership: ${membershipError.message}`);
    return membership ? assignment : null;
  }

  private async createSessionFromCase(studentId: string, caseId: string, assignmentId?: string, assignmentRow?: Row | null) {
    const caseRow = assignmentRow?.cases ?? null;
    const clinicalCase = caseRow
      ? mapCase(caseRow, await this.getPhaseRows(caseId))
      : await this.getCase(caseId);
    if (!clinicalCase) throw new Error("Case not found.");
    if (clinicalCase.status === "archived") throw new ArchivedCaseError();
    if (clinicalCase.status === "superseded" && !assignmentId) throw new SupersededCaseError();
    if (clinicalCase.status !== "available" && !(clinicalCase.status === "superseded" && assignmentId)) throw new Error("This case is not currently available.");
    if (assignmentId) {
      const { data: existing, error: existingError } = await this.client
        .from("sessions")
        .select("id")
        .eq("student_id", studentId)
        .eq("class_case_assignment_id", assignmentId)
        .maybeSingle();
      if (existingError) throw new Error(`Check existing session: ${existingError.message}`);
      if (existing) return (await this.getSession(existing.id))!;
      const now = new Date().toISOString();
      if (!assignmentRow || assignmentRow.case_id !== caseId || assignmentRow.status !== "open" || assignmentRow.opens_at > now || (assignmentRow.due_at && assignmentRow.due_at <= now)) {
        throw new Error("This case assignment is not currently available.");
      }
    }
    const firstPhase = clinicalCase.phases[0];
    if (!firstPhase) throw new Error("This case has no phases.");
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
    if (assignmentId) {
      const { data: sessionId, error: rpcError } = await this.client.rpc("create_session_for_assignment", {
        p_student_id: studentId,
        p_assignment_id: assignmentId,
        p_case_id: caseId,
        p_first_phase_id: firstPhase.id,
        p_initial_state: state,
        p_opening_content: firstPhase.starterQuestion,
      });
      if (rpcError) {
        if (/archived case/i.test(rpcError.message)) throw new ArchivedCaseError();
        if (/superseded case/i.test(rpcError.message)) throw new SupersededCaseError();
        throw new Error(`Create session: ${rpcError.message}`);
      }
      if (typeof sessionId !== "string" || !sessionId) throw new Error("Create session: the database did not return a session ID.");
      const resumed = await this.getSession(sessionId);
      if (!resumed || resumed.session.assignmentId !== assignmentId || resumed.session.messages.length === 0 || !resumed.session.state) {
        throw new Error("Create session: the database returned an incomplete session.");
      }
      return resumed;
    }
    const { data: sessionData, error: sessionError } = await this.client
      .from("sessions")
      .insert({ case_id: caseId, student_id: studentId, class_case_assignment_id: assignmentId, current_phase_id: firstPhase.id, context: { reviewStatus: "pending" } })
      .select("id")
      .single();
    if (sessionError || !sessionData) {
      // The database trigger closes the status-check/insert race. Preserve the
      // public 410 contract when it wins after the repository's preflight.
      if (/archived case/i.test(sessionError?.message ?? "")) throw new ArchivedCaseError();
      if (/superseded case/i.test(sessionError?.message ?? "")) throw new SupersededCaseError();
      throw new Error(`Create session: ${sessionError?.message ?? "no data"}`);
    }
    const session = sessionData;
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
    const [caseRowResult, phaseRows, userResult, messageResult, evaluationResult, stateResult, sessionReviewResult, tutorReviewResult, summaryJobResult] = await Promise.all([
      this.client.from("cases").select("*").eq("id", sessionRow.case_id).single(),
      this.getPhaseRows(sessionRow.case_id),
      this.client.from("users").select("*").eq("id", sessionRow.student_id).single(),
      this.client.from("messages").select("*").eq("session_id", sessionId).order("sequence_no"),
      this.client.from("evaluations").select("*").eq("session_id", sessionId).order("created_at"),
      this.client.from("session_state").select("*").eq("session_id", sessionId).single(),
      this.client.from("session_reviews").select("*").eq("session_id", sessionId).maybeSingle(),
      this.client.from("tutor_turn_reviews").select("*").eq("session_id", sessionId).order("created_at"),
      this.client.from("session_summary_jobs").select("status").eq("session_id", sessionId).maybeSingle(),
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
      summaryGenerationStatus: summaryGenerationStatus(sessionRow, context, summaryJobResult.data ?? null),
      assignment,
      teachingClass,
      reviewClaim: { reviewerId: sessionRow.professor_id ?? null, reviewerName: sessionRow.professor_id ? (await this.listUsers()).find((item) => item.id === sessionRow.professor_id)?.name ?? null : null, state: sessionReview?.status === "completed" ? "completed" : sessionRow.professor_id ? "other" : "unclaimed", canEdit: !sessionRow.professor_id && sessionReview?.status !== "completed" },
    };
  }

  async findCommittedTurn(sessionId: string, studentId: string, clientRequestId: string, content: string) {
    const normalizedRequestId = clientRequestId.trim();
    if (!normalizedRequestId) return null;
    const { data: sessionRow, error: sessionError } = await this.client
      .from("sessions")
      .select("student_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) throw new Error(`Find committed turn session: ${sessionError.message}`);
    if (!sessionRow) return null;
    if (sessionRow.student_id !== studentId) throw new Error("This session belongs to another learner.");
    const { data: messageRow, error: messageError } = await this.client
      .from("messages")
      .select("id, content, sender_id")
      .eq("session_id", sessionId)
      .eq("role", "student")
      .eq("client_request_id", normalizedRequestId)
      .maybeSingle();
    if (messageError) throw new Error(`Find committed turn message: ${messageError.message}`);
    if (!messageRow) return null;
    if (messageRow.sender_id !== studentId || messageRow.content !== content) {
      throw new IdempotencyConflictError();
    }
    // The session ownership check above is deliberately separate from this
    // hydration call: retries return the same authorised bundle as the first
    // request, including the original student/tutor messages and evaluation.
    return this.getSession(sessionId);
  }

  async commitTurn(input: CommitTurnInput) {
    if (input.clientRequestId !== undefined && !input.clientRequestId.trim()) {
      throw new Error("Client request ID cannot be blank.");
    }
    const bundle = await this.getSession(input.sessionId);
    if (!bundle) throw new Error("Session not found.");
    const phase = bundle.case.phases.find((item) => item.order === bundle.session.currentPhase)!;
    const nextPhase = bundle.case.phases.find((item) => item.order === input.nextPhase)!;
    // Reflection turns are formative prompts, not graded answers. Keep their
    // database score null so analytics cannot count them as partial/correct.
    const evaluationScore = input.evaluation.isReflection
      ? null
      : CLASSIFICATION_SCORES[input.evaluation.classification];
    const context = { score: input.score, summary: input.summary, reviewStatus: bundle.session.reviewStatus, pausedAt: null };
    const { error } = await this.client.rpc("commit_tutor_turn", {
      p_session_id: input.sessionId,
      p_student_sender_id: bundle.session.studentId,
      p_student_content: input.studentMessage.content,
      p_student_phase_id: phase.id,
      p_ai_content: input.aiMessage.content,
      p_ai_phase_id: nextPhase.id,
      p_evaluation_type: "formative",
      p_evaluation_score: evaluationScore,
      p_evaluation_criteria: buildEvaluationCriteria(input.evaluation),
      p_evaluation_feedback: input.evaluation.feedback,
      p_evaluator_id: null,
      p_state: input.nextState,
      p_expected_version: input.expectedVersion,
      p_session_context: context,
      p_facts: input.nextState.strengths,
      p_unresolved_questions: input.nextState.previousErrors,
      p_current_phase_id: nextPhase.id,
      p_session_status: input.status,
      p_client_request_id: input.clientRequestId?.trim() || null,
      p_student_metadata: buildMessageMetadata(input.studentMessage, "student"),
      p_ai_metadata: buildMessageMetadata(input.aiMessage, "socratic_tutor"),
    });
    if (error) {
      if (error.message.includes("IDEMPOTENCY_CONFLICT")) throw new IdempotencyConflictError();
      throw new Error(`Commit tutor turn: ${error.message}`);
    }
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
    const gradedReviews = input.reviews.filter((review) => !evaluationMap.get(review.evaluationId)?.isReflection);
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
    for (const review of gradedReviews) {
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
    const finalScore = gradedReviews.length
      ? Math.round(gradedReviews.reduce((sum, item) => sum + CLASSIFICATION_SCORES[item.label], 0) / gradedReviews.length)
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
    if (!rows.length) return [];
    const { data: members, error: memberError } = await this.client
      .from("class_memberships")
      .select("*, users(*)")
      .in("class_id", rows.map((row) => row.id));
    const memberRows = must(members, memberError, "List class members");
    const membersByClass = new Map<string, Row[]>();
    for (const member of memberRows) {
      const current = membersByClass.get(member.class_id) ?? [];
      current.push(member);
      membersByClass.set(member.class_id, current);
    }
    const result = rows.map((row) => mapClass(row, membersByClass.get(row.id) ?? []));
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

  async listCaseVersionsWithDiagnostics() {
    const { data, error } = await this.client.from("cases").select("*").order("created_at");
    const rows = must(data, error, "List case versions");
    if (!rows.length) return { cases: [], diagnostics: [] as CaseAttachmentDiagnostic[] };
    const { data: phaseRows, error: phaseError } = await this.client
      .from("case_phases")
      .select("*")
      .in("case_id", rows.map((row) => row.id))
      .order("phase_order");
    const phases = must(phaseRows, phaseError, "List case version phases");
    const phasesByCase = new Map<string, Row[]>();
    for (const phase of phases) phasesByCase.set(phase.case_id, [...(phasesByCase.get(phase.case_id) ?? []), phase]);
    const mapped = rows.map((row) => mapCaseWithDiagnostics(row, phasesByCase.get(row.id) ?? []));
    return {
      cases: mapped.map((item) => item.case),
      diagnostics: mapped.flatMap((item) => item.diagnostics),
    };
  }

  async listCaseVersions() {
    return (await this.listCaseVersionsWithDiagnostics()).cases;
  }

  async saveCase(input: ClinicalCase, adminId: string) {
    const existingRecord = input.id ? await this.readCaseWithDiagnostics(input.id) : null;
    if (input.id && !existingRecord) throw new Error("Case not found.");
    if (existingRecord?.diagnostics.length) {
      throw new Error("Cannot save a case while it contains invalid stored attachments.");
    }
    const existing = existingRecord?.case ?? null;
    if (existing && existing.status !== "draft") throw new Error("Published cases are immutable. Clone a new version.");
    const caseId = input.id || crypto.randomUUID();
    const version = input.version ?? 1;
    const attachments = normalizeWritableAttachments(caseId, input.attachments ?? existing?.attachments ?? []);
    let existingPatientContext: Record<string, unknown> = {};
    if (existingRecord?.row.patient_context && typeof existingRecord.row.patient_context === "object") {
      existingPatientContext = existingRecord.row.patient_context;
    }
    const teachingMaterialPackageId = input.teachingMaterialPackageId?.trim().toLowerCase();
    if (teachingMaterialPackageId && !HOSTED_PACKAGE_ID.test(teachingMaterialPackageId)) {
      throw new Error("Case teaching-material reference is invalid.");
    }
    const patientContext = {
      ...existingPatientContext,
      attachments,
      findings: input.findings ?? [],
      ...(input.correctionProbes === undefined ? {} : { correctionProbes: input.correctionProbes }),
      ...(teachingMaterialPackageId ? { teachingMaterialPackageId } : {}),
    };
    const phaseRows = input.phases.map((phase, index) => ({
      id: phase.id || crypto.randomUUID(),
      phase_order: index + 1,
      phase_key: `phase_${index + 1}`,
      title: phase.title,
      objectives: [phase.goal, ...phase.rubric.map((criterion) => typeof criterion === "string" ? criterion : criterion.text)],
      questions: [phase.starterQuestion, ...phase.exampleQuestions],
      teaching_notes: phase.tutorGuidance?.join("\n") || phase.goal,
      expected_findings: {},
      metadata: {
        rubric: phase.rubric,
        acceptedExtras: phase.acceptedExtras ?? [],
        tutorGuidance: phase.tutorGuidance ?? [],
        tutorMoves: phase.tutorMoves ?? [],
        ...(phase.noProgressLimit === undefined ? {} : { noProgressLimit: phase.noProgressLimit }),
        ...(phase.phaseCeiling === undefined ? {} : { phaseCeiling: phase.phaseCeiling }),
      },
    }));
    const { data, error } = await this.client.rpc("save_case_draft", {
      p_case_id: caseId,
      p_title: input.title,
      p_slug: buildCaseVersionSlug(input.title, version, caseId),
      p_specialty: "dentistry",
      p_presenting_complaint: input.description,
      p_created_by: adminId,
      p_source_case_id: input.sourceCaseId ?? null,
      p_version: version,
      p_patient_context: patientContext,
      p_attachments: attachments,
      p_tags: input.learningObjectives,
      p_difficulty: input.difficulty,
      p_phases: phaseRows,
    });
    const savedRow = (Array.isArray(data) ? data[0] : data) as Row | null;
    const savedCaseId = must(savedRow, error, "Save case").id;
    return (await this.getCase(savedCaseId))!;
  }

  async publishCase(caseId: string, moveOpenAssignments = true) {
    const current = await this.readCaseWithDiagnostics(caseId);
    if (!current) throw new Error("Case not found.");
    if (current.diagnostics.length) throw new Error("Cannot publish a case while it contains invalid stored attachments.");
    if (!current.case.phases.length) throw new Error("Case must contain at least one phase before publication.");
    assertCaseStatusTransition("publish", current.row.status);
    const { error } = await this.client.rpc("publish_case", {
      p_case_id: caseId,
      p_published_at: new Date().toISOString(),
      p_move_open_assignments: moveOpenAssignments,
    });
    if (error) throw new Error(`Publish case: ${error.message}`);
    return (await this.getCase(caseId))!;
  }

  async archiveCase(caseId: string) {
    const current = await this.readCaseWithDiagnostics(caseId);
    if (!current) throw new Error("Case not found.");
    assertCaseStatusTransition("archive", current.row.status);
    const { error } = await this.client.rpc("archive_case", { p_case_id: caseId });
    if (error) throw new Error(`Archive case: ${error.message}`);
    return (await this.getCase(caseId))!;
  }

  async cloneCase(caseId: string, adminId: string) {
    const sourceRecord = await this.readCaseWithDiagnostics(caseId);
    if (!sourceRecord) throw new Error("Case not found.");
    if (sourceRecord.diagnostics.length) throw new Error("Cannot clone a case while it contains invalid stored attachments.");
    const source = sourceRecord.case;
    const version = getNextCaseVersion(await this.listCaseVersions(), source);
    return this.saveCase({ ...source, id: "", title: getVersionedCaseTitle(source.title, version), status: "draft", sourceCaseId: getCaseLineageId(source), version, publishedAt: null, phases: source.phases.map((phase) => ({ ...phase, id: "" })) }, adminId);
  }

  async listAssignments(professorId?: string) {
    const allowedClassIds = professorId ? new Set((await this.listClasses(professorId)).map((item) => item.id)) : null;
    const { data, error } = await this.client.from("class_case_assignments").select("*, classes(name), cases(title)").order("created_at", { ascending: false });
    return must(data, error, "List assignments").map(mapAssignment).filter((item) => !allowedClassIds || allowedClassIds.has(item.classId));
  }

  async saveAssignment(input: Omit<CaseAssignment, "id" | "createdAt" | "assignedBy"> & { id?: string }, professorId: string) {
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && !input.idempotencyKey.trim()) {
      throw new Error("Assignment idempotency key cannot be blank.");
    }
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    let current: Row | null = null;
    if (input.id || idempotencyKey) {
      const lookup = this.client.from("class_case_assignments").select("*");
      const { data, error } = await (input.id
        ? lookup.eq("id", input.id).maybeSingle()
        : lookup.eq("idempotency_key", idempotencyKey).maybeSingle());
      if (error) throw new Error(`Get case assignment: ${error.message}`);
      current = data;
      if (input.id && !current) throw new Error("Assignment not found.");
    }
    let keyRow: Row | null = null;
    if (input.id && idempotencyKey) {
      const { data, error } = await this.client
        .from("class_case_assignments")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw new Error(`Get case assignment idempotency key: ${error.message}`);
      keyRow = data;
      if (keyRow && keyRow.id !== input.id) throw new AssignmentIdempotencyConflictError();
    }
    const professorClasses = (await this.listClasses(professorId)).filter((item) =>
      item.members.some((member) => member.userId === professorId && member.role === "professor"),
    );
    if (!professorClasses.some((item) => item.id === input.classId)) throw new Error("Professor is outside this class.");
    if (current && !professorClasses.some((item) => item.id === current!.class_id)) {
      throw new Error("Professor is outside this class.");
    }
    if (!input.id && current) {
      if (!sameAssignmentRequest(current, input)) throw new AssignmentIdempotencyConflictError();
      return (await this.listAssignments(professorId)).find((item) => item.id === current!.id)!;
    }
    if (input.id && keyRow && current && !sameAssignmentRequest(current, input)) {
      throw new AssignmentIdempotencyConflictError();
    }
    const clinicalCase = await this.getCase(input.caseId);
    if (!clinicalCase) throw new Error("Case not found.");
    const caseOrClassChanged = current
      ? current.case_id !== input.caseId || current.class_id !== input.classId
      : true;
    if (caseOrClassChanged) {
      if (clinicalCase.status !== "available") throw new Error("Case assignment conflict: only active cases can be assigned.");
    } else if (clinicalCase.status === "archived") {
      if (input.status === "open") throw new Error("Archived case assignments cannot be reopened.");
    } else if (clinicalCase.status !== "available" && clinicalCase.status !== "superseded") {
      throw new Error("Case assignment conflict: only active cases can be assigned.");
    }
    const payload = {
      class_id: input.classId,
      case_id: input.caseId,
      assigned_by: current?.assigned_by ?? professorId,
      status: input.status,
      opens_at: input.opensAt,
      due_at: input.dueAt,
      ...(input.idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
    };
    const operation = input.id
      ? this.client.from("class_case_assignments").update(payload).eq("id", input.id).select("id").single()
      : idempotencyKey
      ? this.client.from("class_case_assignments").insert(payload).select("id").single()
      : this.client.from("class_case_assignments").insert(payload).select("id").single();
    const { data, error } = await operation;
    if (error && /assignments may target only active cases/i.test(error.message)) {
      throw new Error("Case assignment conflict: only active cases can be assigned.");
    }
    if (error && idempotencyKey && assignmentConflict(error)) {
      const { data: conflictRow, error: conflictReadError } = await this.client
        .from("class_case_assignments")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (conflictReadError) throw new Error(`Read assignment idempotency conflict: ${conflictReadError.message}`);
      if (conflictRow && sameAssignmentRequest(conflictRow, input)) {
        return (await this.listAssignments(professorId)).find((item) => item.id === conflictRow.id)!;
      }
      throw new AssignmentIdempotencyConflictError();
    }
    const id = must(data, error, "Save assignment").id;
    return (await this.listAssignments(professorId)).find((item) => item.id === id)!;
  }

  async listStudentOfferings(studentId: string): Promise<StudentCaseOffering[]> {
    // Load only this student's memberships and their related classes. This is
    // both a fixed query count and a fixed tenant boundary: the catalogue path
    // never reads unrelated classes, memberships, students, or sessions.
    const { data: membershipRows, error: membershipError } = await this.client
      .from("class_memberships")
      .select("*, users(*), classes(*)")
      .eq("user_id", studentId)
      .eq("role", "student");
    const memberships = must(membershipRows, membershipError, "List student class memberships");
    const classes = memberships.flatMap((membership) =>
      membership.classes ? [mapClass(membership.classes, [membership])] : [],
    );
    const classIds = classes.map((item) => item.id);
    if (!classIds.length) return [];

    const { data: assignmentRows, error: assignmentError } = await this.client
      .from("class_case_assignments")
      .select("*, classes(name), cases(title)")
      .eq("status", "open")
      .in("class_id", classIds)
      .order("created_at", { ascending: false });
    // Treat the database predicate as a performance optimization, not the
    // only safety boundary. Keeping the status check here protects callers
    // backed by a mock/client that does not apply PostgREST filters.
    const assignments = must(assignmentRows, assignmentError, "List student assignments")
      .map(mapAssignment)
      .filter((assignment) => assignment.status === "open");
    if (!assignments.length) return [];

    const assignmentIds = assignments.map((item) => item.id);
    const { data: sessionRows, error: sessionError } = await this.client
      .from("sessions")
      .select("id, case_id, class_case_assignment_id, status, context")
      .eq("student_id", studentId)
      .in("class_case_assignment_id", assignmentIds);
    const sessions = must(sessionRows, sessionError, "List student sessions");
    const sessionByAssignment = new Map<string, Row>();
    for (const session of sessions) {
      if (session.class_case_assignment_id && !sessionByAssignment.has(session.class_case_assignment_id)) {
        sessionByAssignment.set(session.class_case_assignment_id, session);
      }
    }
    const caseIds = [...new Set([
      ...assignments.map((item) => item.caseId),
      ...sessions.map((session) => session.case_id).filter((id): id is string => typeof id === "string"),
    ])];
    const [
      { data: caseRows, error: caseError },
      { data: phaseRows, error: phaseError },
    ] = await Promise.all([
      this.client.from("cases").select("*").in("id", caseIds),
      this.client.from("case_phases").select("*").in("case_id", caseIds).order("phase_order"),
    ]);
    const cases = must(caseRows, caseError, "List student cases");
    const phases = must(phaseRows, phaseError, "List student case phases");
    const phasesByCase = new Map<string, Row[]>();
    for (const phase of phases) {
      const current = phasesByCase.get(phase.case_id) ?? [];
      current.push(phase);
      phasesByCase.set(phase.case_id, current);
    }
    const caseById = new Map(cases.map((row) => [row.id, row]));
    const classById = new Map(classes.map((item) => [item.id, item]));
    const now = new Date().toISOString();
    const offerings: StudentCaseOffering[] = [];
    for (const assignment of assignments) {
      const existing = sessionByAssignment.get(assignment.id);
      const offeringCaseId = existing?.case_id ?? assignment.caseId;
      const caseRow = caseById.get(offeringCaseId);
      const teachingClass = classById.get(assignment.classId);
      // A superseded case can remain an explicit open assignment when the
      // publisher chose not to move it. Existing sessions always use their
      // own case_id, even after an assignment is moved to a newer version.
      if (!caseRow || (caseRow.status !== "active" && caseRow.status !== "superseded" && !existing) || caseRow.is_test_fixture === true || !teachingClass) continue;
      const offering: StudentCaseOffering = {
        assignment,
        teachingClass,
        case: mapCase(caseRow, phasesByCase.get(offeringCaseId) ?? []),
        existingSessionId: existing?.id ?? null,
        existingSessionStatus: existing?.status ?? null,
        existingSessionPausedAt: existing?.context?.pausedAt ?? null,
        availability: assignment.status !== "open" || (assignment.dueAt && assignment.dueAt <= now) ? "closed" : assignment.opensAt > now ? "upcoming" : "open",
      };
      if (offering.availability === "open" || offering.availability === "upcoming") offerings.push(offering);
    }
    return offerings;
  }

  async listStaffSessions(query: StaffSessionQuery = {}, professorId?: string): Promise<StaffSessionPage> {
    return this.listStaffSessionsViaRpc(query, professorId);
  }

  private async listStaffSessionsViaRpc(query: StaffSessionQuery = {}, professorId?: string): Promise<StaffSessionPage> {
    const limit = normalizeStaffSessionLimit(query.limit);
    const cursor = decodeStaffSessionCursor(query.cursor);
    const reviewFilter = query.reviewFilter ?? "all";
    const [pageResult, rollupResult] = await Promise.all([
      this.client.rpc("list_staff_session_summaries", {
        p_professor_id: professorId ?? null,
        p_class_id: query.classId ?? null,
        p_review_filter: reviewFilter,
        p_cursor_created_at: cursor?.createdAt ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_limit: limit,
      }),
      this.client.rpc("get_staff_session_rollup", {
        p_professor_id: professorId ?? null,
        p_class_id: query.classId ?? null,
      }),
    ]);
    if (pageResult.error) throw new Error(`List staff sessions: ${pageResult.error.message}`);
    if (rollupResult.error) throw new Error(`Roll up staff sessions: ${rollupResult.error.message}`);
    const pageRows = (pageResult.data ?? []) as Row[];
    const rawRollup = Array.isArray(rollupResult.data) ? rollupResult.data[0] : rollupResult.data;
    const rollup = (rawRollup ?? {}) as Row;
    const stats = {
      total: Number(rollup.total ?? 0),
      completed: Number(rollup.completed ?? 0),
      reviewed: Number(rollup.reviewed ?? 0),
      available: Number(rollup.available ?? 0),
      mine: Number(rollup.mine ?? 0),
      claimed: Number(rollup.claimed ?? 0),
    };
    const assignmentProgress = (rollup.assignment_progress && typeof rollup.assignment_progress === "object")
      ? Object.fromEntries(Object.entries(rollup.assignment_progress as Record<string, Row>).map(([id, value]) => [id, {
        sessionCount: Number(value.sessionCount ?? value.session_count ?? 0),
        completedCount: Number(value.completedCount ?? value.completed_count ?? 0),
      }]))
      : {};
    const hasMore = pageRows.length > limit;
    const visibleRows = pageRows.slice(0, limit);
    const summaries = visibleRows.map((row) => {
      const session = staffSessionFromRow({
        id: row.session_id,
        case_id: row.case_id,
        student_id: row.student_id,
        class_case_assignment_id: row.assignment_id,
        status: row.session_status,
        professor_id: row.reviewer_id,
        context: { reviewStatus: row.review_status, score: row.score },
        created_at: row.created_at,
        ended_at: row.completed_at,
      });
      const state = staffReviewState(session, professorId);
      const claimState: NonNullable<SessionBundle["reviewClaim"]>["state"] = state === "claimed" ? "other" : state === "mine" ? "mine" : state === "completed" ? "completed" : "unclaimed";
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
        case: { id: row.case_id, title: row.case_title, ...(row.case_version === undefined || row.case_version === null ? {} : { version: Number(row.case_version) }) },
        student: { id: row.student_id, name: row.student_name },
        assignment: { id: row.assignment_id, classId: row.assignment_class_id },
        teachingClass: { id: row.assignment_class_id, name: row.class_name },
        reviewClaim: {
          reviewerId: session.reviewerId ?? null,
          reviewerName: row.reviewer_name ?? null,
          state: claimState,
          canEdit: session.reviewStatus !== "completed" && (!session.reviewerId || session.reviewerId === professorId),
        },
      };
    });
    const last = visibleRows.at(-1);
    return {
      sessions: summaries,
      nextCursor: hasMore && last ? encodeStaffSessionCursor({ createdAt: last.created_at, id: last.session_id }) : null,
      stats,
      assignmentProgress,
    };
  }

  async listSessionsForProfessor(professorId: string): Promise<SessionBundle[]> {
    const assignmentIds = new Set((await this.listAssignments(professorId)).map((item) => item.id));
    const sessions = (await this.listSessions()).filter((item) => item.session.assignmentId && assignmentIds.has(item.session.assignmentId));
    const users = await this.listUsers();
    return sessions.map((bundle) => ({ ...bundle, reviewClaim: { reviewerId: bundle.session.reviewerId ?? null, reviewerName: bundle.session.reviewerId ? users.find((item) => item.id === bundle.session.reviewerId)?.name ?? null : null, state: bundle.session.reviewStatus === "completed" ? "completed" as const : !bundle.session.reviewerId ? "unclaimed" as const : bundle.session.reviewerId === professorId ? "mine" as const : "other" as const, canEdit: bundle.session.reviewStatus !== "completed" && (!bundle.session.reviewerId || bundle.session.reviewerId === professorId) } }));
  }

  async getAdminOverview(): Promise<AdminOverview> {
    return this.getStaffOverviewCounts();
  }

  private async getStaffOverviewCounts(): Promise<AdminOverview> {
    const count = async (table: string, filter?: (query: any) => any) => {
      let query: any = this.client.from(table).select("id", { count: "exact", head: true });
      if (filter) query = filter(query);
      const { count: total, error } = await query;
      if (error) throw new Error(`Count ${table}: ${error.message}`);
      return total ?? 0;
    };
    const [userCount, classCount, openAssignmentCount, sessionCount, completedCount, pendingReviewCount, unclaimedReviewCount] = await Promise.all([
      count("users"),
      count("classes"),
      count("class_case_assignments", (query) => query.eq("status", "open")),
      count("sessions"),
      count("sessions", (query) => query.eq("status", "completed")),
      count("sessions", (query) => query.eq("status", "completed").or("context->>reviewStatus.is.null,context->>reviewStatus.neq.completed")),
      count("sessions", (query) => query.eq("status", "completed").is("professor_id", null).or("context->>reviewStatus.is.null,context->>reviewStatus.neq.completed")),
    ]);
    return {
      userCount,
      classCount,
      openAssignmentCount,
      sessionCount,
      pendingReviewCount,
      completionRate: sessionCount ? Math.round((completedCount / sessionCount) * 100) : 0,
      unclaimedReviewCount,
    };
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
