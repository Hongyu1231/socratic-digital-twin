import type { Evaluation, LearnerState, SessionBundle, TutorMessage, TutorMove } from "@/lib/domain";
import { calculateScore } from "@/lib/domain";
import { getRepository } from "@/lib/repository";
import { evaluateWithFallback, getTutorMode } from "@/lib/tutor";
import { buildSessionSummary } from "@/lib/tutor/summary";
import { withIdempotency } from "@/lib/idempotency";
import { TUTOR_PROMPT_VERSION } from "@/lib/tutor/prompt";
import { applyHumanizationExperiment } from "@/lib/experiments/shadow";
import { contentHash } from "@/lib/experiments/privacy";
import { selectTutorMove } from "@/lib/tutor/question-planner";
import { mergeLearnerEvidence } from "@/lib/tutor/learner-model";
import { buildStudentVisibleTutorReply } from "@/lib/tutor/correction-policy";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export async function submitStudentAnswer(
  sessionId: string,
  studentId: string,
  content: string,
  clientRequestId?: string,
): Promise<SessionBundle> {
  if (clientRequestId) {
    return withIdempotency(`${studentId}:${sessionId}:${clientRequestId}`, () =>
      performStudentAnswer(sessionId, studentId, content),
    );
  }
  return performStudentAnswer(sessionId, studentId, content);
}

async function performStudentAnswer(
  sessionId: string,
  studentId: string,
  content: string,
): Promise<SessionBundle> {
  const repository = getRepository();
  const bundle = await repository.getSession(sessionId);
  if (!bundle) throw new Error("Session not found.");
  if (bundle.session.studentId !== studentId) throw new Error("This session belongs to another learner.");
  if (bundle.session.status !== "active") throw new Error("This learning session is already complete.");
  if (bundle.session.pausedAt) throw new Error("Resume this session before submitting another answer.");

  const phase = bundle.case.phases.find((item) => item.order === bundle.session.currentPhase);
  if (!phase) throw new Error("The current teaching phase is invalid.");
  const phaseKey = String(phase.order);
  const attempt = (bundle.session.state.phaseAttempts[phaseKey] ?? 0) + 1;
  const currentQuestion = [...bundle.session.messages].reverse().find((message) => message.sender === "ai")?.content;
  const recentDialogue = bundle.session.messages.slice(-8).map(({ sender, content: messageContent }) => ({ sender, content: messageContent }));
  const recentEvaluations = bundle.session.evaluations.slice(-4).map(({ classification, misconceptionKey, reasoningGap, phaseOrder }) => ({
    classification,
    misconceptionKey: misconceptionKey ?? null,
    reasoningGap,
    phaseOrder,
  }));
  const caseContext = {
    title: bundle.case.title,
    description: bundle.case.description,
    learningObjectives: bundle.case.learningObjectives,
    attachments: (bundle.case.attachments ?? []).map(({ kind, title, description, transcript }) => ({
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
  const baselineResult = await evaluateWithFallback(tutorInput);
  const experimentDecision = await applyHumanizationExperiment({
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
  const result = experimentDecision.studentResult;
  const orderedPhases = [...bundle.case.phases].sort((left, right) => left.order - right.order);
  const phaseIndex = orderedPhases.findIndex((item) => item.id === phase.id);
  const isFinalPhase = phaseIndex === orderedPhases.length - 1;
  const scriptedMove = selectTutorMove(phase, content, bundle.session.state, result.classification);
  const usedTutorMoves = new Set(bundle.session.state.usedTutorMoves ?? []);
  const currentQuestionIsReflection = /reflect|looking back|across the whole case|highest[- ]leverage|most important|greatest influence|consequential decision point|assumption|uncertainty|change your (?:reasoning|plan|decision)/i.test(currentQuestion ?? "");
  const systemReflectionMove: TutorMove | undefined = isFinalPhase
    && result.classification === "correct"
    && !scriptedMove
    && !currentQuestionIsReflection
    && !usedTutorMoves.has("system-final-reflection")
    ? {
      id: "system-final-reflection",
      strategy: "reflect",
      question: "Looking back, which finding or uncertainty had the greatest influence on your decision?",
      blockAdvancement: true,
    }
    : undefined;
  const tutorMove = scriptedMove ?? systemReflectionMove;
  const misconceptionKey = result.classification === "wrong"
    ? scriptedMove
      ? `move:${scriptedMove.id}`
      : result.misconceptionKey
    : null;
  const phaseComplete = result.classification === "correct" && !tutorMove?.blockAdvancement;
  const sessionComplete = phaseComplete && isFinalPhase;
  const nextPhaseRecord = phaseComplete && !isFinalPhase ? orderedPhases[phaseIndex + 1] : phase;
  const nextPhase = nextPhaseRecord.order;
  const now = new Date().toISOString();
  const memoryPatch = tutorMove?.recordError
    ? { ...result.memoryPatch, addErrors: [...result.memoryPatch.addErrors, tutorMove.recordError] }
    : result.memoryPatch;
  const evidence = mergeLearnerEvidence(bundle.session.state, memoryPatch, result.classification);
  const appliedStrategy = tutorMove?.strategy ?? result.strategy;

  const nextState: LearnerState = {
    ...bundle.session.state,
    currentGoal: nextPhaseRecord.goal,
    previousErrors: evidence.previousErrors,
    strengths: evidence.strengths,
    weaknesses: evidence.weaknesses,
    nextStrategy: appliedStrategy,
    phaseAttempts: {
      ...bundle.session.state.phaseAttempts,
      [phaseKey]: attempt,
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
  const nextQuestion = sessionComplete
    ? `You have completed all ${orderedPhases.length} phases. Your learning summary is ready.`
    : phaseComplete
      ? nextPhaseRecord.starterQuestion
      : buildStudentVisibleTutorReply(
        { ...result, misconceptionKey, nextQuestion: tutorMove?.question ?? result.nextQuestion },
        bundle.session.evaluations,
        phase.order,
        { hasScriptedMove: Boolean(scriptedMove) },
      );
  const aiMessage: TutorMessage = {
    id: crypto.randomUUID(),
    sessionId,
    sender: "ai",
    content: nextQuestion,
    timestamp: new Date(Date.now() + 1).toISOString(),
    replyToMessageId: studentMessage.id,
  };

  const committed = await repository.commitTurn({
    sessionId,
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
