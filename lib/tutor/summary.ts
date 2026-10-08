import type { Evaluation, LearnerState, SessionSummary } from "@/lib/domain";
import { calculateScore } from "@/lib/domain";
import { removeSummaryContradictions } from "@/lib/tutor/learner-model";

function unique(values: string[]) {
  return [...new Set(values)].slice(0, 4);
}

export function buildSessionSummary(
  evaluations: Evaluation[],
  state: LearnerState,
  completedAllPhases: boolean,
): SessionSummary {
  const score = calculateScore(evaluations);
  const reconciled = removeSummaryContradictions(
    unique(state.strengths),
    unique([...state.weaknesses, ...state.previousErrors]),
  );
  const strengths = reconciled.strengths;
  const weaknesses = reconciled.weaknesses;
  const supportedPhases = Object.entries(state.phaseProgress ?? {})
    .filter(([, progress]) => progress.completedWithSupport)
    .map(([order]) => Number(order)).sort((a, b) => a - b);
  return {
    overallScore: score,
    headline:
      score >= 80
        ? "Your reasoning is well backed by evidence"
        : score >= 55
          ? "A sound start, with some gaps to go back over"
          : "Try linking each decision to a finding in the case",
    narrative: (completedAllPhases
      ? "You finished all the phases and the reflection. The score reflects how well you explained your reasoning, not just your final answer."
      : "You ended the session before finishing all the phases. This summary covers the reasoning you showed so far. Treat it as feedback to learn from.")
      + (supportedPhases.length ? ` ${supportedPhases.length === 1 ? "Phase" : "Phases"} ${supportedPhases.join(", ")} ${supportedPhases.length === 1 ? "was" : "were"} completed with tutor support, not demonstrated independent mastery.` : ""),
    strengths: strengths.length ? strengths : ["Kept working through the questions"],
    // An empty gap list is meaningful: do not invent a deficit after the
    // learner has resolved the recorded ones. The UI has an explicit empty state.
    weaknesses,
    nextSteps: [
      "Say what you see before you name a conclusion",
      "Explain what each new test or image would tell you",
      "Name one assumption that could change your plan",
    ],
    completedAllPhases,
    supportedPhases,
  };
}
