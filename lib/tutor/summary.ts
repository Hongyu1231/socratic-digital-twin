import type { Evaluation, LearnerState, SessionSummary } from "@/lib/domain";
import { calculateScore } from "@/lib/domain";

function unique(values: string[]) {
  return [...new Set(values)].slice(0, 4);
}

export function buildSessionSummary(
  evaluations: Evaluation[],
  state: LearnerState,
  completedAllPhases: boolean,
): SessionSummary {
  const score = calculateScore(evaluations);
  const strengths = unique(state.strengths);
  const weaknesses = unique([...state.weaknesses, ...state.previousErrors]);
  return {
    overallScore: score,
    headline:
      score >= 80
        ? "Evidence-led reasoning is taking shape"
        : score >= 55
          ? "A sound foundation with gaps to revisit"
          : "Slow down and anchor each decision to evidence",
    narrative: completedAllPhases
      ? "You worked through identification, assessment, risk, management and reflection. The score reflects the quality of the reasoning expressed, not simply the final conclusion."
      : "You ended the session before all five phases were completed. This summary reflects the reasoning evidence available so far and should be treated as formative feedback.",
    strengths: strengths.length ? strengths : ["Stayed engaged with iterative questioning"],
    weaknesses: weaknesses.length ? weaknesses : ["Make the link between findings and decisions more explicit"],
    nextSteps: [
      "State the clinical finding before naming a conclusion",
      "Justify the next investigation in terms of the uncertainty it resolves",
      "Name one assumption that could change the management plan",
    ],
    completedAllPhases,
  };
}
