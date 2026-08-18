import type { Evaluation, LearnerState, SessionBundle, TutorMessage } from "@/lib/domain";
import { calculateScore } from "@/lib/domain";
import { getRepository } from "@/lib/repository";
import { evaluateWithFallback, getTutorMode } from "@/lib/tutor";
import { buildSessionSummary } from "@/lib/tutor/summary";
import { withIdempotency } from "@/lib/idempotency";
import { TUTOR_PROMPT_VERSION } from "@/lib/tutor/prompt";
import { applyHumanizationExperiment } from "@/lib/experiments/shadow";
import { contentHash } from "@/lib/experiments/privacy";

const uniqueRecent = (existing: string[], additions: string[], limit = 8) =>
  [...new Set([...existing, ...additions])].slice(-limit);

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
  const baselineResult = await evaluateWithFallback({
    phase,
    answer: content,
    state: bundle.session.state,
    attempt,
  });
  const experimentDecision = await applyHumanizationExperiment({
    sessionId,
    turnKey: clientRequestKey(sessionId, bundle.session.state.version),
    phase,
    answer: content,
    state: bundle.session.state,
    attempt,
    baseline: baselineResult,
  });
  const result = experimentDecision.studentResult;
  const phaseComplete = result.classification === "correct" || attempt >= 3;
  const isFinalPhase = phase.order === bundle.case.phases.length;
  const sessionComplete = phaseComplete && isFinalPhase;
  const nextPhase = phaseComplete && !isFinalPhase ? phase.order + 1 : phase.order;
  const nextPhaseRecord = bundle.case.phases.find((item) => item.order === nextPhase) ?? phase;
  const now = new Date().toISOString();

  const nextState: LearnerState = {
    ...bundle.session.state,
    currentGoal: nextPhaseRecord.goal,
    previousErrors: uniqueRecent(bundle.session.state.previousErrors, result.memoryPatch.addErrors),
    strengths: uniqueRecent(bundle.session.state.strengths, result.memoryPatch.addStrengths),
    weaknesses: uniqueRecent(bundle.session.state.weaknesses, result.memoryPatch.addWeaknesses),
    nextStrategy: result.strategy,
    phaseAttempts: {
      ...bundle.session.state.phaseAttempts,
      [phaseKey]: attempt,
      ...(phaseComplete && !isFinalPhase ? { [String(nextPhase)]: 0 } : {}),
    },
    mastery: {
      ...bundle.session.state.mastery,
      [phaseKey]: clamp((bundle.session.state.mastery[phaseKey] ?? 0) + result.memoryPatch.masteryDelta),
    },
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
    strategy: result.strategy,
    phaseComplete,
    feedback: result.feedback,
    phaseOrder: phase.order,
    attempt,
    provider: result.source,
    model: experimentDecision.model ?? (result.source === "openai"
      ? process.env.OPENAI_MODEL ?? "unknown"
      : result.source === "claude"
        ? process.env.CLAUDE_MODEL ?? "unknown"
        : "deterministic-rules-v1"),
    promptVersion: experimentDecision.promptVersion
      ?? (result.source === "deterministic" ? "deterministic-v1" : TUTOR_PROMPT_VERSION),
    createdAt: now,
  };
  const allEvaluations = [...bundle.session.evaluations, evaluation];
  // Completion must never wait for an external model. The database enqueues an
  // optional LLM enhancement after this deterministic summary is committed.
  const summary = sessionComplete ? buildSessionSummary(allEvaluations, nextState, true) : null;
  const nextQuestion = sessionComplete
    ? "You have completed all five phases. Open your learning summary and reflect on what you would test next."
    : result.nextQuestion;
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
