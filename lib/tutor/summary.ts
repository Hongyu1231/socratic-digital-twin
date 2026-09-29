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
        ? "Evidence-led reasoning is taking shape"
        : score >= 55
          ? "A sound foundation with gaps to revisit"
          : "Slow down and anchor each decision to evidence",
    narrative: (completedAllPhases
      ? "You worked through identification, assessment, risk, management and reflection. The score reflects the quality of the reasoning expressed, not simply the final conclusion."
      : "You ended the session before all assigned phases were completed. This summary reflects the reasoning evidence available so far and should be treated as formative feedback.")
      + (supportedPhases.length ? ` ${supportedPhases.length === 1 ? "Phase" : "Phases"} ${supportedPhases.join(", ")} ${supportedPhases.length === 1 ? "was" : "were"} completed with tutor support, not demonstrated independent mastery.` : ""),
    strengths: strengths.length ? strengths : ["Stayed engaged with iterative questioning"],
    // An empty gap list is meaningful: do not invent a deficit after the
    // learner has resolved the recorded ones. The UI has an explicit empty state.
    weaknesses,
    nextSteps: [
      "State the clinical finding before naming a conclusion",
      "Justify the next investigation in terms of the uncertainty it resolves",
      "Name one assumption that could change the management plan",
    ],
    completedAllPhases,
    supportedPhases,
  };
}
