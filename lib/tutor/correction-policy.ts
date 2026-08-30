import type { Evaluation, TutorEvaluationResult } from "@/lib/domain";

export const EXPLICIT_CORRECTION_CONFIDENCE = 0.85;
export const WRONG_ANSWER_BASIS_PROBE = "What evidence or case finding supports that statement?";

function isHighConfidenceWrong(result: Pick<Evaluation, "classification" | "confidence">) {
  return result.classification === "wrong" && result.confidence >= EXPLICIT_CORRECTION_CONFIDENCE;
}

export function shouldExplicitlyCorrect(
  current: Pick<TutorEvaluationResult, "classification" | "confidence" | "misconceptionKey">,
  previousEvaluations: Evaluation[],
  phaseOrder: number,
) {
  if (!isHighConfidenceWrong(current)) return false;
  const previous = previousEvaluations.at(-1);
  return Boolean(
    current.misconceptionKey
    && previous
    && previous.phaseOrder === phaseOrder
    && previous.misconceptionKey === current.misconceptionKey
    && isHighConfidenceWrong(previous),
  );
}

/**
 * The model continues to supply one safe, open-ended next question. The state
 * machine owns the narrow exception that precedes it with an explicit verdict
 * after two consecutive, high-confidence wrong classifications.
 */
export function buildStudentVisibleTutorReply(
  current: Pick<TutorEvaluationResult, "classification" | "confidence" | "misconceptionKey" | "nextQuestion">,
  previousEvaluations: Evaluation[],
  phaseOrder: number,
  options: { hasScriptedMove?: boolean } = {},
) {
  if (shouldExplicitlyCorrect(current, previousEvaluations, phaseOrder)) {
    return `That statement is incorrect. ${current.nextQuestion}`;
  }
  if (isHighConfidenceWrong(current) && !options.hasScriptedMove) return WRONG_ANSWER_BASIS_PROBE;
  return current.nextQuestion;
}
