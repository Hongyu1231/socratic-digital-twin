import type { CriteriaMet, CriterionEvidence, Evaluation } from "@/lib/domain";

export function readMisconceptionKey(criteria: Record<string, unknown>) {
  return typeof criteria.misconceptionKey === "string" && criteria.misconceptionKey.length > 0
    ? criteria.misconceptionKey
    : null;
}

function isCriterionEvidence(value: unknown): value is CriterionEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && record.id.length > 0
    && typeof record.evidence === "string"
    && record.evidence.length > 0;
}

/**
 * Read both the v2 structured evidence and the historical string[] form.
 * Historical rows stay string[] so this reader never fabricates evidence.
 * Malformed entries are ignored while leaving the rest of the evaluation
 * usable.
 */
export function readCriteriaMet(criteria: Record<string, unknown>): CriteriaMet | undefined {
  const value = criteria.criteriaMet;
  if (!Array.isArray(value)) return undefined;
  if (value.every((item) => typeof item === "string")) {
    return value.filter((item): item is string => item.length > 0);
  }
  const structured = value.filter(isCriterionEvidence).map((item) => ({
    id: item.id,
    evidence: item.evidence,
  }));
  return structured.length ? structured : undefined;
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
    targetCriterionId: evaluation.targetCriterionId ?? null,
    criteriaMet: evaluation.criteriaMet ?? [],
    supportLevel: evaluation.supportLevel ?? 0,
    completedWithSupport: evaluation.completedWithSupport ?? false,
    isReflection: evaluation.isReflection ?? false,
    retrieval: evaluation.retrieval ?? null,
  };
}
