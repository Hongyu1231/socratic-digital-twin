import type { Evaluation } from "@/lib/domain";

export function readMisconceptionKey(criteria: Record<string, unknown>) {
  return typeof criteria.misconceptionKey === "string" && criteria.misconceptionKey.length > 0
    ? criteria.misconceptionKey
    : null;
}

export function buildEvaluationCriteria(evaluation: Evaluation) {
  return {
    classification: evaluation.classification,
    confidence: evaluation.confidence,
    reasoningGap: evaluation.reasoningGap,
    misconceptionKey: evaluation.misconceptionKey ?? null,
    strategy: evaluation.strategy,
    phaseComplete: evaluation.phaseComplete,
    feedback: evaluation.feedback,
    phaseOrder: evaluation.phaseOrder,
    attempt: evaluation.attempt,
    provider: evaluation.provider,
    fallbackFrom: evaluation.fallbackFrom,
    model: evaluation.model,
    promptVersion: evaluation.promptVersion,
  };
}
