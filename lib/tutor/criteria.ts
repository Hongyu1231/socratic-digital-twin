import type { CasePhase, RubricCriterion, TutorEvaluationResult } from "@/lib/domain";

/** Index IDs are a compatibility bridge for legacy string rubrics, not new content IDs. */
export function phaseCriteria(phase: Pick<CasePhase, "rubric">): RubricCriterion[] {
  return phase.rubric.map((item, index) => typeof item === "string"
    ? { id: `r${index + 1}`, text: item }
    : item);
}

export const rubricText = (item: string | RubricCriterion) => typeof item === "string" ? item : item.text;

/** Invalid optional annotations must not discard a usable classification. */
export function normalizeCriterionTags(result: TutorEvaluationResult, phase: CasePhase): TutorEvaluationResult {
  const allowed = new Set(phaseCriteria(phase).map((criterion) => criterion.id));
  const legacy = phase.rubric.every((criterion) => typeof criterion === "string");
  // Older adapters had no tags. Only preserve their established legacy-rubric
  // completion rule; explicit criteria always require explicit evidence tags.
  const met = result.criteriaMet ?? (legacy && result.classification === "correct" ? [...allowed] : []);
  const acknowledgement = result.acknowledgement?.trim();
  return {
    ...result,
    targetCriterionId: result.targetCriterionId && allowed.has(result.targetCriterionId) ? result.targetCriterionId : null,
    criteriaMet: result.classification === "wrong" ? [] : [...new Set(met.filter((id) => allowed.has(id)))],
    acknowledgement: acknowledgement && acknowledgement.length <= 200 && !/[?？]/.test(acknowledgement)
      ? acknowledgement : undefined,
  };
}
