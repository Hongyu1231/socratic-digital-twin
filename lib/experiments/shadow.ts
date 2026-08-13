import type { CasePhase, LearnerState, TutorEvaluationResult } from "@/lib/domain";
import { getHumanizationStore } from "@/lib/experiments/store";
import { outputSafetyCheck } from "@/lib/experiments/core";
import { ClaudeTutor } from "@/lib/tutor/claude";
import { OpenAITutor } from "@/lib/tutor/openai";

interface ShadowInput {
  sessionId: string;
  turnKey: string;
  phase: CasePhase;
  answer: string;
  state: LearnerState;
  attempt: number;
  baseline: TutorEvaluationResult;
}

export interface ExperimentDecision {
  studentResult: TutorEvaluationResult;
  experimentId: string | null;
  arm: "baseline" | "candidate";
  model?: string;
  promptVersion?: string;
}

function candidateEngine(provider: string, model: string, instructions: string, promptVersion: string) {
  if (provider === "openai" && process.env.OPENAI_API_KEY) return new OpenAITutor(process.env.OPENAI_API_KEY, model, { instructions, promptVersion });
  if (provider === "claude" && process.env.ANTHROPIC_API_KEY) return new ClaudeTutor(process.env.ANTHROPIC_API_KEY, model, { instructions, promptVersion });
  return null;
}

/**
 * Run a candidate out-of-band. Shadow results are recorded but can never alter
 * the learner response. A/B only serves a candidate after an approved release,
 * and safety failure always returns the baseline result.
 */
export async function applyHumanizationExperiment(input: ShadowInput): Promise<ExperimentDecision> {
  const store = getHumanizationStore();
  let active: Awaited<ReturnType<typeof store.activeExperiment>>;
  try { active = await store.activeExperiment(input.sessionId); } catch { return { studentResult: input.baseline, experimentId: null, arm: "baseline" }; }
  if (!active) return { studentResult: input.baseline, experimentId: null, arm: "baseline" };
  const engine = candidateEngine(active.candidate.provider, active.candidate.model, active.candidate.instructions, active.candidate.promptVersion);
  if (!engine) return { studentResult: input.baseline, experimentId: active.experiment.id, arm: "baseline" };
  let candidate: TutorEvaluationResult;
  try { candidate = await engine.evaluate({ phase: input.phase, answer: input.answer, state: input.state, attempt: input.attempt }); }
  catch { return { studentResult: input.baseline, experimentId: active.experiment.id, arm: "baseline" }; }
  const safety = outputSafetyCheck(candidate.nextQuestion);
  void store.saveShadowResult({ experimentId: active.experiment.id, turnKey: input.turnKey, arm: active.arm, baselineOutput: input.baseline, candidateOutput: candidate, safetyPassed: safety.passed }).catch(() => undefined);
  // A/B exposure is already protected by the frozen-eval and completed-shadow
  // database gates. It stays capped at 25%; the later faculty release records
  // whether the observed candidate may become an approved tutor version.
  const canServe = active.experiment.mode === "ab" && active.arm === "candidate" && safety.passed;
  return {
    studentResult: canServe ? candidate : input.baseline,
    experimentId: active.experiment.id,
    arm: canServe ? "candidate" : "baseline",
    model: canServe ? active.candidate.model : undefined,
    promptVersion: canServe ? active.candidate.promptVersion : undefined,
  };
}
