import type { CasePhase, CriteriaMet, CriterionEvidence, RubricCriterion, TutorEvaluationResult } from "@/lib/domain";
import { CRITERION_EVIDENCE_MAX_LENGTH } from "@/lib/domain";

/** Index IDs are a compatibility bridge for legacy string rubrics, not new content IDs. */
export function phaseCriteria(phase: Pick<CasePhase, "rubric">): RubricCriterion[] {
  return phase.rubric.map((item, index) => typeof item === "string"
    ? { id: `r${index + 1}`, text: item }
    : item);
}

export const rubricText = (item: string | RubricCriterion) => typeof item === "string" ? item : item.text;

function isStructuredCriterionEvidence(value: string | CriterionEvidence): value is CriterionEvidence {
  return typeof value !== "string"
    && typeof value.id === "string"
    && typeof value.evidence === "string";
}

/** Extract IDs for progression while preserving the stored representation. */
export function criterionIds(criteriaMet: CriteriaMet | undefined): string[] {
  if (!criteriaMet) return [];
  return criteriaMet.flatMap((item) => typeof item === "string" ? [item] : [item.id]);
}

function normalizeCriteriaMet(criteriaMet: CriteriaMet | undefined, allowed: Set<string>, legacy: boolean, classification: TutorEvaluationResult["classification"]): CriteriaMet {
  // No provider tag is a supported legacy path. Only infer IDs for the old
  // all-string rubric adapter; never invent evidence for historical data.
  if (!criteriaMet) return legacy && classification === "correct" ? [...allowed] : [];

  if (criteriaMet.every((item) => typeof item === "string")) {
    return [...new Set(criteriaMet.filter((id) => allowed.has(id)))];
  }

  return criteriaMet.flatMap((item) => {
    if (!isStructuredCriterionEvidence(item) || !allowed.has(item.id)) return [];
    const evidence = item.evidence.trim().slice(0, CRITERION_EVIDENCE_MAX_LENGTH);
    return evidence ? [{ id: item.id, evidence }] : [];
  }).filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

/** Invalid optional annotations must not discard a usable classification. */
export function normalizeCriterionTags(result: TutorEvaluationResult, phase: CasePhase): TutorEvaluationResult {
  const allowed = new Set(phaseCriteria(phase).map((criterion) => criterion.id));
  const legacy = !phase.acceptedExtras?.length && phase.rubric.every((criterion) => typeof criterion === "string");
  const acknowledgement = result.acknowledgement?.trim();
  return {
    ...result,
    targetCriterionId: result.targetCriterionId && allowed.has(result.targetCriterionId) ? result.targetCriterionId : null,
    answerCriterionId: result.answerCriterionId && allowed.has(result.answerCriterionId) ? result.answerCriterionId : null,
    criteriaMet: normalizeCriteriaMet(result.criteriaMet, allowed, legacy, result.classification),
    acknowledgement: acknowledgement && acknowledgement.length <= 200 && !/[?？]/.test(acknowledgement)
      ? acknowledgement : undefined,
  };
}
