import type { Evaluation, LearnerState, SessionBundle, TutorMessage, TutorEvaluationResult } from "@/lib/domain";
import { calculateScore } from "@/lib/domain";
import { getRepository } from "@/lib/repository";
import { evaluateWithFallback, getTutorMode } from "@/lib/tutor";
import { generateTutorSupport } from "@/lib/tutor/support";
import { buildSessionSummary } from "@/lib/tutor/summary";
import { TUTOR_PROMPT_VERSION } from "@/lib/tutor/prompt";
import { applyHumanizationExperiment, type ExperimentDecision } from "@/lib/experiments/shadow";
import { contentHash } from "@/lib/experiments/privacy";
import { selectTutorMove } from "@/lib/tutor/question-planner";
import { mergeLearnerEvidence } from "@/lib/tutor/learner-model";
import { buildStudentVisibleTutorReply } from "@/lib/tutor/correction-policy";
import { getTeachingContextWithTrace, getTeachingContextWithTraceAsync } from "@/lib/materials/retrieval";
import { normalizeCriterionTags, phaseCriteria } from "@/lib/tutor/criteria";
import { avoidRepeatedQuestion, progressPhase, requestHelpProgress, supportQuestion, supportTarget } from "@/lib/tutor/progression";
import { remainingTutorRequestMs, startTutorRequestBudget } from "@/lib/tutor/request-budget";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const HELP_REQUEST_MARKER = "Requested more help";

/** Retryable failure used only when an explicit level-0 Help hypothetical could
 * not be generated. No marker or state is committed before this is thrown. */
export class HelpGenerationRetryableError extends Error {
  readonly code = "HELP_GENERATION_RETRYABLE" as const;
  readonly retryable = true as const;

  constructor(message = "More help is temporarily unavailable. Please try again.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HelpGenerationRetryableError";
  }
}

function isRealAnswerForPhase(bundle: SessionBundle, phaseOrder: number) {
  const messages = new Map(bundle.session.messages.map((message) => [message.id, message]));
  return bundle.session.evaluations.some((evaluation) => {
    if (evaluation.isReflection) return false;
    const message = messages.get(evaluation.messageId);
    if (!message || message.sender !== "student"
      || message.turnKind === "help" || message.helpRequested === true) return false;
    const recordedPhase = evaluation.phaseOrder ?? message.phaseOrder;
    // Untagged legacy answer/evaluation pairs can safely unlock Help only in
    // the initial phase. Once a session has advanced, treating any old row as
    // current would incorrectly enable Help at the start of a new phase.
    return recordedPhase === phaseOrder || (recordedPhase === undefined && phaseOrder === 1);
  });
}

/**
 * Server-side Help availability predicate shared by the student DTO and the
 * Help command. It intentionally relies on an evaluated answer, not merely a
 * message, so a forged marker or failed model call cannot unlock the button.
 */
export function canRequestHelp(bundle: SessionBundle): boolean {
  if (bundle.session.status !== "active" || Boolean(bundle.session.pausedAt)) return false;
  const phase = bundle.case.phases.find((item) => item.order === bundle.session.currentPhase);
  if (!phase) return false;
  const finalPhase = [...bundle.case.phases].sort((left, right) => left.order - right.order).at(-1);
  // A stale reflection flag on a non-final phase is ignored just as the
  // answer state machine ignores it; only the actual final reflection blocks
  // Help availability.
  if (finalPhase?.id === phase.id
    && (bundle.session.state.reflectionAnswered || bundle.session.state.reflectionAsked)) return false;
  const phaseProgress = bundle.session.state.phaseProgress?.[String(phase.order)];
  const messageSupport = bundle.session.messages
    .filter((message) => message.phaseOrder === phase.order)
    .reduce((level, message) => Math.max(level, message.supportLevel ?? 0), 0);
  const evaluationSupport = bundle.session.evaluations
    .filter((evaluation) => !evaluation.isReflection && evaluation.phaseOrder === phase.order)
    .reduce((level, evaluation) => Math.max(level, evaluation.supportLevel ?? 0), 0);
  if (Math.max(phaseProgress?.supportLevel ?? 0, messageSupport, evaluationSupport) >= 2
    || phaseProgress?.awaitingApplication
    || phaseProgress?.completed) return false;
  return isRealAnswerForPhase(bundle, phase.order);
}

export async function submitStudentAnswer(
  sessionId: string,
  studentId: string,
  content: string,
  clientRequestId?: string,
): Promise<SessionBundle> {
  // Durable repository deduplication is authoritative across instances. Avoid
  // the old process cache: it bypassed current ownership and payload checks.
  return performStudentAnswer(sessionId, studentId, content, clientRequestId);
}

/**
 * Apply one explicit Help press. Help is an ungraded, idempotent turn: the
 * request is replayed before status/eligibility checks, and only an eligible
 * request reaches support generation or persistence.
 */
export async function submitTutorHelp(
  sessionId: string,
  studentId: string,
  clientRequestId: string,
): Promise<SessionBundle> {
  const requestDeadline = startTutorRequestBudget();
  const requestId = clientRequestId?.trim();
  if (!requestId) throw new Error("Help requests require a client request ID.");

  const repository = getRepository();
  const bundle = await repository.getSession(sessionId);
  if (!bundle) throw new Error("Session not found.");
  if (bundle.session.studentId !== studentId) throw new Error("This session belongs to another learner.");

  // Replay is deliberately before status, pause and Help-availability checks:
  // a retry must return the original turn after a phase/session transition.
  const replay = await repository.findCommittedTurn(
    sessionId,
    studentId,
    requestId,
    HELP_REQUEST_MARKER,
    "help",
  );
  if (replay) return replay;

  // Disallowed presses are harmless no-ops. In particular, do not retrieve
  // context or call a provider on this path.
  if (!canRequestHelp(bundle)) return bundle;
  const phase = bundle.case.phases.find((item) => item.order === bundle.session.currentPhase);
  if (!phase) return bundle;
  const phaseKey = String(phase.order);
  const transition = requestHelpProgress(bundle.session.state.phaseProgress?.[phaseKey]);
  if (!transition.eligible) return bundle;
  const target = supportTarget(phase, transition.state);
  if (!target) return bundle;

  const currentQuestion = [...bundle.session.messages]
    .reverse()
    .find((message) => message.sender === "ai")?.content;
  // Never put the server-generated Help marker into support/retrieval text.
  const recentDialogue = bundle.session.messages
    .slice(-8)
    .filter((message) => !(message.sender === "student"
      && (message.turnKind === "help" || message.helpRequested === true)))
    .map(({ sender, content }) => ({ sender, content }));
  const recentEvaluations = bundle.session.evaluations.slice(-4).map(({ classification, misconceptionKey, reasoningGap, phaseOrder }) => ({
    classification,
    misconceptionKey: misconceptionKey ?? null,
    reasoningGap,
    phaseOrder,
  }));
  const query = `${currentQuestion ?? ""} ${phase.goal}`.trim();
  const retrieval = bundle.case.teachingMaterialPackageId
    ? await getTeachingContextWithTraceAsync(bundle.case.sourceCaseId ?? bundle.case.id, query, bundle.case.teachingMaterialPackageId)
    : getTeachingContextWithTrace(bundle.case.sourceCaseId ?? bundle.case.id, query);
  const caseContext = {
    title: bundle.case.title,
    description: bundle.case.description,
    learningObjectives: bundle.case.learningObjectives,
    teachingContext: retrieval.context,
    findings: (bundle.case.findings ?? []).filter((finding) => finding.unlockPhase <= phase.order),
    attachments: (bundle.case.attachments ?? [])
      .filter((attachment) => (attachment.unlockPhase ?? 1) <= phase.order)
      .map(({ kind, title, description, transcript }) => ({
        kind,
        title,
        description,
        ...(transcript ? { transcript } : {}),
      })),
  };

  let generated: Awaited<ReturnType<typeof generateTutorSupport>> = null;
  const supportTimeoutMs = remainingTutorRequestMs(requestDeadline);
  try {
    if (supportTimeoutMs > 0) {
      generated = await generateTutorSupport({
        phase,
        caseContext,
        state: { ...bundle.session.state, phaseProgress: { ...bundle.session.state.phaseProgress, [phaseKey]: transition.state } },
        currentQuestion,
        recentDialogue,
        recentEvaluations,
        support: { level: transition.state.supportLevel as 1 | 2, targetCriterion: target },
        timeoutMs: supportTimeoutMs,
      });
    }
  } catch (error) {
    if (transition.state.supportLevel === 1) throw new HelpGenerationRetryableError(undefined, { cause: error });
    // A deterministic level-2 reveal is always available from the criterion;
    // a provider failure must not strand the learner at level 1.
    generated = null;
  }
  const supportContent = generated?.content?.trim() || supportQuestion(phase, transition.state);
  if (transition.state.supportLevel === 1 && !generated?.content?.trim()) {
    throw new HelpGenerationRetryableError();
  }
  const configuredProvider = getTutorMode();
  const supportProvider = generated?.source ?? "deterministic";
  const supportFallbackFrom = !generated && configuredProvider !== "deterministic" ? configuredProvider : undefined;

  const now = new Date().toISOString();
  const nextState: LearnerState = {
    ...bundle.session.state,
    phaseProgress: { ...bundle.session.state.phaseProgress, [phaseKey]: transition.state },
    // Help does not consume an answer attempt or change learner evidence,
    // mastery, score, criteria, correction history or current phase.
    version: bundle.session.state.version + 1,
    updatedAt: now,
  };
  const studentMessage: TutorMessage = {
    id: crypto.randomUUID(),
    sessionId,
    sender: "student",
    content: HELP_REQUEST_MARKER,
    timestamp: now,
    turnKind: "help",
    helpRequested: true,
    phaseOrder: phase.order,
    supportLevel: transition.state.supportLevel,
    completedWithSupport: transition.state.completedWithSupport,
  };
  const aiMessage: TutorMessage = {
    id: crypto.randomUUID(),
    sessionId,
    sender: "ai",
    content: supportContent,
    timestamp: new Date(Date.now() + 1).toISOString(),
    replyToMessageId: studentMessage.id,
    moveType: transition.state.supportLevel === 2 ? "reveal" : "hypothetical",
    supportProvider,
    ...(supportFallbackFrom ? { supportFallbackFrom } : {}),
    turnKind: "help",
    helpRequested: true,
    phaseOrder: phase.order,
    supportLevel: transition.state.supportLevel,
    completedWithSupport: transition.state.completedWithSupport,
    retrieval: retrieval.trace,
  };
  const committed = await repository.commitTurn({
    sessionId,
    clientRequestId: requestId,
    expectedVersion: bundle.session.state.version,
    studentMessage,
    evaluation: null,
    aiMessage,
    nextState,
    nextPhase: bundle.session.currentPhase,
    status: bundle.session.status,
    score: bundle.session.score,
    summary: bundle.session.summary,
    completedAt: bundle.session.completedAt,
  });
  committed.runtime.tutor = supportProvider;
  committed.runtime.fallbackFrom = supportFallbackFrom;
  return committed;
}

async function performStudentAnswer(
  sessionId: string,
  studentId: string,
  content: string,
  clientRequestId?: string,
): Promise<SessionBundle> {
  const requestDeadline = startTutorRequestBudget();
  const repository = getRepository();
  const bundle = await repository.getSession(sessionId);
  if (!bundle) throw new Error("Session not found.");
  if (bundle.session.studentId !== studentId) throw new Error("This session belongs to another learner.");
  if (clientRequestId) {
    const replay = await repository.findCommittedTurn(sessionId, studentId, clientRequestId, content);
    if (replay) return replay;
  }
  if (bundle.session.status !== "active") throw new Error("This learning session is already complete.");
  if (bundle.session.pausedAt) throw new Error("Resume this session before submitting another answer.");

  const phase = bundle.case.phases.find((item) => item.order === bundle.session.currentPhase);
  if (!phase) throw new Error("The current teaching phase is invalid.");
  const orderedPhases = [...bundle.case.phases].sort((left, right) => left.order - right.order);
  const phaseIndex = orderedPhases.findIndex((item) => item.id === phase.id);
  const isFinalPhase = phaseIndex === orderedPhases.length - 1;
  const phaseKey = String(phase.order);
  const isReflectionAnswer = isFinalPhase && bundle.session.state.reflectionAsked === true && !bundle.session.state.reflectionAnswered;
  const attempt = (bundle.session.state.phaseAttempts[phaseKey] ?? 0) + 1;
  const currentQuestion = [...bundle.session.messages].reverse().find((message) => message.sender === "ai")?.content;
  const recentDialogue = bundle.session.messages
    .slice(-8)
    .filter((message) => !(message.sender === "student"
      && (message.turnKind === "help" || message.helpRequested === true)))
    .map(({ sender, content: messageContent }) => ({ sender, content: messageContent }));
  const recentEvaluations = bundle.session.evaluations.slice(-4).map(({ classification, misconceptionKey, reasoningGap, phaseOrder }) => ({
    classification,
    misconceptionKey: misconceptionKey ?? null,
    reasoningGap,
    phaseOrder,
  }));
  const query = `${content} ${currentQuestion ?? ""} ${phase.goal}`;
  const retrieval = isReflectionAnswer ? { context: undefined, trace: { query: "", passages: [] } }
    : bundle.case.teachingMaterialPackageId
      ? await getTeachingContextWithTraceAsync(bundle.case.sourceCaseId ?? bundle.case.id, query, bundle.case.teachingMaterialPackageId)
      : getTeachingContextWithTrace(bundle.case.sourceCaseId ?? bundle.case.id, query);
  const caseContext = {
    title: bundle.case.title,
    description: bundle.case.description,
    learningObjectives: bundle.case.learningObjectives,
    teachingContext: retrieval.context,
    findings: (bundle.case.findings ?? []).filter((finding) => finding.unlockPhase <= phase.order),
    attachments: (bundle.case.attachments ?? []).filter((attachment) => (attachment.unlockPhase ?? 1) <= phase.order).map(({ kind, title, description, transcript }) => ({
      kind,
      title,
      description,
      ...(transcript ? { transcript } : {}),
    })),
  };
  const tutorInput = {
    phase,
    caseContext,
    answer: content,
    state: bundle.session.state,
    attempt,
    currentQuestion,
    recentDialogue,
    recentEvaluations,
  };
  const baselineResult: TutorEvaluationResult = isReflectionAnswer ? {
    classification: "partial", confidence: 0, misconceptionKey: null, strategy: "reflect",
    reasoningGap: "Ungraded final reflection.", feedback: "Final reflection recorded without a grading gate.",
    nextQuestion: "What would you revisit next?", criteriaMet: [], source: "deterministic",
    memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: [], masteryDelta: 0 },
  } : await evaluateWithFallback({
    ...tutorInput,
    timeoutMs: remainingTutorRequestMs(requestDeadline),
  });
  // Private teaching context must not enter persisted experiment/shadow logs
  // or a separately configured candidate model.
  const experimentDecision: ExperimentDecision = caseContext.teachingContext || isReflectionAnswer
    ? { studentResult: baselineResult, experimentId: null, arm: "baseline" }
    : await applyHumanizationExperiment({
      sessionId,
      turnKey: clientRequestKey(sessionId, bundle.session.state.version),
      phase,
      caseContext,
      answer: content,
      state: bundle.session.state,
      attempt,
      currentQuestion,
      recentDialogue,
      recentEvaluations,
      baseline: baselineResult,
      timeoutMs: remainingTutorRequestMs(requestDeadline),
      deadlineMs: requestDeadline,
    });
  const result = normalizeCriterionTags(experimentDecision.studentResult, phase);
  // The final phase's reflect move is the closing question. It is asked when
  // the phase completes, never selected as an ordinary mid-phase move.
  const reflectMove = isFinalPhase ? phase.tutorMoves?.find((move) => move.strategy === "reflect") : undefined;
  const scriptedMove = isReflectionAnswer ? undefined : selectTutorMove(
    reflectMove ? { ...phase, tutorMoves: phase.tutorMoves?.filter((move) => move.strategy !== "reflect") } : phase,
    content, bundle.session.state, result.classification);
  const usedTutorMoves = new Set(bundle.session.state.usedTutorMoves ?? []);
  const tutorMove = scriptedMove;
  const misconceptionKey = result.classification === "wrong"
    ? scriptedMove
      ? `move:${scriptedMove.id}`
      : result.misconceptionKey
    : null;
  const progress = isReflectionAnswer ? null : progressPhase(phase, bundle.session.state.phaseProgress?.[phaseKey], result, attempt,
    Boolean(tutorMove?.blockAdvancement));
  // The step up is decided only after the answer is graded, so the dedicated
  // ungraded support helper writes the level 1 plan or level 2 reveal. Any
  // failure uses the fixed text (the explicit Help path has stricter retry
  // semantics for a missing level-1 hypothetical).
  const target = progress?.escalated ? supportTarget(phase, progress.state) : undefined;
  let supportReply: string | undefined;
  const supportTimeoutMs = remainingTutorRequestMs(requestDeadline);
  if (progress?.escalated && target && progress.state.supportLevel !== 0 && getTutorMode() !== "deterministic" && supportTimeoutMs > 0) {
    try {
      const written = await generateTutorSupport({
        ...tutorInput,
        state: { ...bundle.session.state, phaseProgress: { ...bundle.session.state.phaseProgress, [phaseKey]: progress.state } },
        support: { level: progress.state.supportLevel, targetCriterion: target },
        timeoutMs: supportTimeoutMs,
      });
      if (written?.content?.trim()) supportReply = written.content.trim();
    } catch {
      supportReply = undefined;
    }
  }
  const phaseComplete = progress?.complete ?? false;
  const supported = progress?.state.completedWithSupport ?? false;
  const askReflection = phaseComplete && isFinalPhase;
  const sessionComplete = isReflectionAnswer;
  const nextPhaseRecord = phaseComplete && !isFinalPhase ? orderedPhases[phaseIndex + 1] : phase;
  const nextPhase = nextPhaseRecord.order;
  const now = new Date().toISOString();
  const memoryPatch = tutorMove?.recordError
    ? { ...result.memoryPatch, addErrors: [...result.memoryPatch.addErrors, tutorMove.recordError] }
    : result.memoryPatch;
  const evidence = isReflectionAnswer ? bundle.session.state : mergeLearnerEvidence(bundle.session.state, memoryPatch, result.classification, {
    phaseOrder: phase.order,
    phaseComplete: phaseComplete && !supported,
  });
  const appliedStrategy = tutorMove?.strategy ?? result.strategy;

  const nextState: LearnerState = {
    ...bundle.session.state,
    currentGoal: nextPhaseRecord.goal,
    previousErrors: evidence.previousErrors,
    strengths: evidence.strengths,
    weaknesses: evidence.weaknesses,
    phaseEvidence: evidence.phaseEvidence,
    phaseProgress: progress ? { ...bundle.session.state.phaseProgress, [phaseKey]: progress.state } : bundle.session.state.phaseProgress,
    reflectionAsked: askReflection || (isFinalPhase && bundle.session.state.reflectionAsked === true),
    reflectionAnswered: isReflectionAnswer || (isFinalPhase && bundle.session.state.reflectionAnswered === true),
    nextStrategy: appliedStrategy,
    phaseAttempts: {
      ...bundle.session.state.phaseAttempts,
      [phaseKey]: isReflectionAnswer ? attempt - 1 : attempt,
      ...(phaseComplete && !isFinalPhase ? { [String(nextPhaseRecord.order)]: 0 } : {}),
    },
    mastery: {
      ...bundle.session.state.mastery,
      [phaseKey]: clamp((bundle.session.state.mastery[phaseKey] ?? 0) + memoryPatch.masteryDelta),
    },
    usedTutorMoves: tutorMove
      ? [...usedTutorMoves, tutorMove.id].slice(-30)
      : [...usedTutorMoves].slice(-30),
    version: bundle.session.state.version + 1,
    updatedAt: now,
  };

  const studentMessage: TutorMessage = {
    id: crypto.randomUUID(),
    sessionId,
    sender: "student",
    content,
    timestamp: now,
    turnKind: "answer",
    helpRequested: false,
    phaseOrder: phase.order,
    supportLevel: progress?.state.supportLevel ?? bundle.session.state.phaseProgress?.[phaseKey]?.supportLevel ?? 0,
    completedWithSupport: supported,
  };
  const evaluation: Evaluation = {
    id: crypto.randomUUID(),
    messageId: studentMessage.id,
    classification: result.classification,
    confidence: result.confidence,
    reasoningGap: result.reasoningGap,
    misconceptionKey,
    strategy: appliedStrategy,
    phaseComplete,
    criteriaMet: result.criteriaMet,
    answerCriterionId: isReflectionAnswer ? undefined : result.answerCriterionId ?? undefined,
    targetCriterionId: (tutorMove?.targetCriterionId && phaseCriteria(phase).some((item) => item.id === tutorMove.targetCriterionId)
      ? tutorMove.targetCriterionId : tutorMove ? undefined : result.targetCriterionId ?? undefined),
    supportLevel: progress?.state.supportLevel ?? bundle.session.state.phaseProgress?.[phaseKey]?.supportLevel ?? 0,
    completedWithSupport: supported,
    isReflection: isReflectionAnswer,
    retrieval: retrieval.trace,
    feedback: result.feedback,
    phaseOrder: phase.order,
    attempt,
    provider: result.source,
    fallbackFrom: result.fallbackFrom,
    model: experimentDecision.model ?? (result.source === "openai"
      ? process.env.OPENAI_MODEL ?? "unknown"
      : result.source === "claude"
        ? process.env.CLAUDE_MODEL ?? "unknown"
        : "deterministic-rules-v2"),
    promptVersion: experimentDecision.promptVersion
      ?? (result.source === "deterministic" ? "deterministic-v2" : TUTOR_PROMPT_VERSION),
    createdAt: now,
  };
  const allEvaluations = [...bundle.session.evaluations, evaluation];
  // Completion must never wait for an external model. The database enqueues an
  // optional LLM enhancement after this deterministic summary is committed.
  const summary = sessionComplete ? buildSessionSummary(allEvaluations, nextState, true) : null;
  const proposedQuestion = sessionComplete
    ? `You have completed all ${orderedPhases.length} ${orderedPhases.length === 1 ? "phase" : "phases"}. Your learning summary is ready.`
    : askReflection
      ? reflectMove?.question ?? "Looking back, which finding or uncertainty had the greatest influence on your decision?"
      : phaseComplete
      ? nextPhaseRecord.starterQuestion
      : progress?.escalated
        ? supportReply ?? supportQuestion(phase, progress.state)
      : tutorMove?.question ?? result.nextQuestion;
  // Acknowledgements and correction verdicts are stored in content for the
  // legacy UI. Compare the actual question, including when it is scripted.
  const earlierQuestions = bundle.session.messages.filter((message) => message.sender === "ai").map((message) => {
    const question = message.acknowledgement && message.content.startsWith(`${message.acknowledgement} `)
      ? message.content.slice(message.acknowledgement.length + 1) : message.content;
    return question.replace(/^That statement is incorrect\.\s*/, "");
  });
  const baseQuestion = phaseComplete || sessionComplete || progress?.escalated ? proposedQuestion
    : avoidRepeatedQuestion(proposedQuestion, earlierQuestions, phase, attempt);
  // Log the actual displayed target, not a discarded model/script proposal.
  if (phaseComplete || isReflectionAnswer || baseQuestion !== proposedQuestion) evaluation.targetCriterionId = undefined;
  else if (progress?.escalated) evaluation.targetCriterionId = progress.state.supportLevel === 2 || supportReply ? target?.id : undefined;
  // Correction is independent of scaffolding: escalating must not suppress
  // the promised explicit verdict on a repeated high-confidence wrong answer.
  const nextQuestion = sessionComplete ? baseQuestion : buildStudentVisibleTutorReply(
    { ...result, misconceptionKey, nextQuestion: baseQuestion }, bundle.session.evaluations, phase.order,
    { hasScriptedMove: Boolean(scriptedMove), correctionProbes: bundle.case.correctionProbes ?? 1 },
  );
  const acknowledgement = isReflectionAnswer ? undefined : supported
    ? "We have completed this phase with support; any remaining gaps are recorded for review."
    : result.acknowledgement;
  const moveType: TutorMessage["moveType"] = askReflection ? "reflection" : phaseComplete || sessionComplete ? "transition"
    : progress?.escalated ? progress.state.supportLevel === 2 ? "reveal" : "hypothetical"
      : nextQuestion.startsWith("That statement is incorrect.") ? "correction" : "question";
  const aiMessage: TutorMessage = {
    id: crypto.randomUUID(),
    sessionId,
    sender: "ai",
    // Keep the existing UI readable. acknowledgement is also stored separately
    // as metadata; consumers must not append it to content a second time.
    content: acknowledgement ? `${acknowledgement} ${nextQuestion}` : nextQuestion,
    acknowledgement,
    moveType,
    timestamp: new Date(Date.now() + 1).toISOString(),
    replyToMessageId: studentMessage.id,
    turnKind: "answer",
    helpRequested: false,
    phaseOrder: phase.order,
    supportLevel: progress?.state.supportLevel ?? bundle.session.state.phaseProgress?.[phaseKey]?.supportLevel ?? 0,
    completedWithSupport: supported,
  };

  const committed = await repository.commitTurn({
    sessionId,
    clientRequestId,
    expectedVersion: bundle.session.state.version,
    studentMessage,
    evaluation,
    aiMessage,
    nextState,
    nextPhase,
    status: sessionComplete ? "completed" : "active",
    score: summary ? calculateScore(allEvaluations) : null,
    summary,
    completedAt: sessionComplete ? now : null,
  });
  committed.runtime.tutor = result.source;
  committed.runtime.fallbackFrom = result.fallbackFrom;
  return committed;
}

function clientRequestKey(sessionId: string, version: number) {
  // Never persist answer text as an experiment key. The state version provides
  // per-session turn uniqueness and remains independent of learner identity.
  return contentHash(`${sessionId}:${version}`).slice(0, 24);
}

export async function finishSession(sessionId: string, studentId: string) {
  const repository = getRepository();
  const bundle = await repository.getSession(sessionId);
  if (!bundle) throw new Error("Session not found.");
  if (bundle.session.studentId !== studentId) throw new Error("This session belongs to another learner.");
  const summary =
    bundle.session.summary ?? buildSessionSummary(bundle.session.evaluations, bundle.session.state, false);
  const completed = await repository.completeSession(sessionId, summary, new Date().toISOString());
  completed.runtime.tutor = getTutorMode();
  return completed;
}
