import type { Evaluation, TutorEvaluationResult } from "@/lib/domain";

export const EXPLICIT_CORRECTION_CONFIDENCE = 0.85;

function isHighConfidenceWrong(result: Pick<Evaluation, "classification" | "confidence">) {
  return result.classification === "wrong" && result.confidence >= EXPLICIT_CORRECTION_CONFIDENCE;
}

export function shouldExplicitlyCorrect(
  current: Pick<TutorEvaluationResult, "classification" | "confidence">,
  previousEvaluations: Evaluation[],
  phaseOrder: number,
) {
  if (!isHighConfidenceWrong(current)) return false;
  const previous = previousEvaluations.at(-1);
  return Boolean(previous && previous.phaseOrder === phaseOrder && isHighConfidenceWrong(previous));
}

/**
 * The model continues to supply one safe, open-ended next question. The state
 * machine owns the narrow exception that precedes it with an explicit verdict
 * after two consecutive, high-confidence wrong classifications.
 */
export function buildStudentVisibleTutorReply(
  current: Pick<TutorEvaluationResult, "classification" | "confidence" | "nextQuestion">,
  previousEvaluations: Evaluation[],
  phaseOrder: number,
) {
  if (!shouldExplicitlyCorrect(current, previousEvaluations, phaseOrder)) return current.nextQuestion;
  return `That statement is incorrect. ${current.nextQuestion}`;
}
