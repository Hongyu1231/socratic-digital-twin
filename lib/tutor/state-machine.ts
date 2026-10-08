import type { Evaluation, LearnerState, SessionBundle, TutorMessage, TutorEvaluationResult } from "@/lib/domain";
import { calculateScore } from "@/lib/domain";
import { getRepository } from "@/lib/repository";
import { evaluateWithFallback, getTutorMode } from "@/lib/tutor";
import { buildSessionSummary } from "@/lib/tutor/summary";
import { TUTOR_PROMPT_VERSION } from "@/lib/tutor/prompt";
import { applyHumanizationExperiment, type ExperimentDecision } from "@/lib/experiments/shadow";
import { contentHash } from "@/lib/experiments/privacy";
import { selectTutorMove } from "@/lib/tutor/question-planner";
import { mergeLearnerEvidence } from "@/lib/tutor/learner-model";
import { buildStudentVisibleTutorReply } from "@/lib/tutor/correction-policy";
import { getTeachingContextWithTrace, getTeachingContextWithTraceAsync } from "@/lib/materials/retrieval";
import { normalizeCriterionTags, phaseCriteria } from "@/lib/tutor/criteria";
import { avoidRepeatedQuestion, progressPhase, supportQuestion, supportTarget } from "@/lib/tutor/progression";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

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

async function performStudentAnswer(
  sessionId: string,
  studentId: string,
  content: string,
  clientRequestId?: string,
): Promise<SessionBundle> {
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
  const recentDialogue = bundle.session.messages.slice(-8).map(({ sender, content: messageContent }) => ({ sender, content: messageContent }));
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
  } : await evaluateWithFallback(tutorInput);
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
  // The step up is decided only after the answer is graded, so the model
  // writes the level 1 plan or level 2 reveal in a second call that carries
  // the new level and the target criterion. Any failure uses the fixed text.
  const target = progress?.escalated ? supportTarget(phase, progress.state) : undefined;
  let supportReply: string | undefined;
  if (progress?.escalated && target && progress.state.supportLevel !== 0 && getTutorMode() !== "deterministic") {
    try {
      const written = await evaluateWithFallback({
        ...tutorInput,
        state: { ...bundle.session.state, phaseProgress: { ...bundle.session.state.phaseProgress, [phaseKey]: progress.state } },
        support: { level: progress.state.supportLevel, targetCriterion: target },
      });
      if (written.source !== "deterministic") supportReply = written.nextQuestion;
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
