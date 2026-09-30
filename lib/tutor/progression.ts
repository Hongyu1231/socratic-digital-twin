import type { CasePhase, Classification, PhaseTutorProgress, TutorEvaluationResult } from "@/lib/domain";
import { criterionIds, phaseCriteria } from "@/lib/tutor/criteria";

const rank: Record<Classification, number> = { wrong: 0, vague: 1, partial: 2, correct: 3 };

export function progressPhase(phase: CasePhase, previous: PhaseTutorProgress | undefined,
  result: TutorEvaluationResult, attempt: number, blocked: boolean) {
  const criteria = phaseCriteria(phase);
  const ids = new Set(criteria.map((criterion) => criterion.id));
  const before: PhaseTutorProgress = previous ?? {
    criteriaMet: [], bestClassification: "wrong", noProgressCount: 0,
    supportLevel: 0, awaitingApplication: false, completedWithSupport: false, completed: false,
  };
  const met = new Set(before.criteriaMet.filter((id) => ids.has(id)));
  // Criteria evidence is an independent annotation from the per-answer
  // quality label. It can accumulate for any classification; classification
  // still drives the best-label/no-progress counter and correction policy.
  for (const id of criterionIds(result.criteriaMet)) if (ids.has(id)) met.add(id);
  const improved = (met.size > before.criteriaMet.length
    || rank[result.classification] > rank[before.bestClassification]);
  const state: PhaseTutorProgress = {
    ...before, criteriaMet: [...met],
    bestClassification: rank[result.classification] > rank[before.bestClassification] ? result.classification : before.bestClassification,
    noProgressCount: improved ? 0 : before.noProgressCount + 1,
  };
  if (before.awaitingApplication) {
    // This is a pedagogical exit, not a change to the answer's grade. Even an
    // unresolved application response can move on without erasing its gaps.
    return { state: { ...state, awaitingApplication: false, completed: true, completedWithSupport: true }, complete: true, escalated: false };
  }
  if (criteria.length > 0 && met.size === criteria.length && !blocked) {
    return { state: { ...state, completed: true }, complete: true, escalated: false };
  }
  const oldLevel = state.supportLevel;
  if (attempt >= (phase.phaseCeiling ?? 8)) state.supportLevel = 2;
  else if (state.noProgressCount >= (phase.noProgressLimit ?? 2)) state.supportLevel = Math.min(2, oldLevel + 1) as 0 | 1 | 2;
  const escalated = state.supportLevel !== oldLevel;
  if (escalated) state.noProgressCount = 0;
  if (state.supportLevel === 2) state.awaitingApplication = true;
  return { state, complete: false, escalated };
}

const sentence = (text: string) => {
  const value = text.replace(/[?？]/g, ".").trim();
  return /[.!。！]$/.test(value) ? value : `${value}.`;
};
export function supportQuestion(phase: CasePhase, progress: PhaseTutorProgress) {
  if (progress.supportLevel === 2) {
    const criterion = phaseCriteria(phase).find((item) => !progress.criteriaMet.includes(item.id)) ?? phaseCriteria(phase)[0];
    const point = criterion?.revealText ?? criterion?.text ?? phase.goal;
    return `Review point: ${sentence(point)} How would you apply this point to the case using the available evidence?`;
  }
  return `Suppose a colleague reached a conclusion without checking the evidence for this goal: ${sentence(phase.goal)} What would you challenge first?`;
}

export function avoidRepeatedQuestion(question: string, earlier: string[], phase: CasePhase, attempt: number) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const previous = new Set(earlier.map(normalize));
  if (!previous.has(normalize(question))) return question;
  return phase.exampleQuestions.find((candidate) => !previous.has(normalize(candidate)))
    ?? `For this attempt (${attempt}), which part of the current goal remains unclear, and what evidence would help you address it?`;
}
