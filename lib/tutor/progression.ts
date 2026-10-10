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
  // A bonus-only answer must not postpone support by improving its quality
  // label. The answer tag refers to required reasoning, not the next question.
  const classificationImproved = (!(phase.acceptedExtras?.length)
    || Boolean(result.answerCriterionId && ids.has(result.answerCriterionId)))
    && rank[result.classification] > rank[before.bestClassification];
  const improved = met.size > before.criteriaMet.filter((id) => ids.has(id)).length || classificationImproved;
  const state: PhaseTutorProgress = {
    ...before, criteriaMet: [...met],
    bestClassification: classificationImproved ? result.classification : before.bestClassification,
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
  // Five evaluated answers is the global pre-reveal ceiling.  A phase may
  // still override it explicitly; Help presses never increment `attempt`.
  if (attempt >= (phase.phaseCeiling ?? 5)) state.supportLevel = 2;
  else if (state.noProgressCount >= (phase.noProgressLimit ?? 2)) state.supportLevel = Math.min(2, oldLevel + 1) as 0 | 1 | 2;
  const escalated = state.supportLevel !== oldLevel;
  if (escalated) state.noProgressCount = 0;
  if (state.supportLevel === 2) state.awaitingApplication = true;
  return { state, complete: false, escalated };
}

/**
 * Apply one explicit Help press to the current phase progress.  This is kept
 * separate from `progressPhase`: Help is an ungraded event and must not alter
 * criteria, the best classification, attempts, mastery or correction state.
 */
export function requestHelpProgress(previous: PhaseTutorProgress | undefined) {
  const before: PhaseTutorProgress = previous ?? {
    criteriaMet: [], bestClassification: "wrong", noProgressCount: 0,
    supportLevel: 0, awaitingApplication: false, completedWithSupport: false, completed: false,
  };
  if (before.supportLevel >= 2) return { state: before, eligible: false as const };
  const supportLevel = Math.min(2, before.supportLevel + 1) as 0 | 1 | 2;
  const state: PhaseTutorProgress = {
    ...before,
    noProgressCount: 0,
    supportLevel,
    ...(supportLevel === 2 ? { awaitingApplication: true, completedWithSupport: true } : {}),
  };
  return { state, eligible: true as const };
}

const sentence = (text: string) => {
  const value = text.replace(/[?？]/g, ".").trim();
  return /[.!。！]$/.test(value) ? value : `${value}.`;
};
export const SUPPORT_FALLBACK_QUESTION = "Which finding would you check first, and why?";

/** The criterion a step-up is about: the first unmet one. */
export function supportTarget(phase: CasePhase, progress: PhaseTutorProgress) {
  return phaseCriteria(phase).find((item) => !progress.criteriaMet.includes(item.id)) ?? phaseCriteria(phase)[0];
}

/** Fixed step-up wording, used when the model cannot write it. Never contains the phase goal. */
export function supportQuestion(phase: CasePhase, progress: PhaseTutorProgress) {
  const criterion = supportTarget(phase, progress);
  const point = criterion?.revealText ?? criterion?.text;
  if (progress.supportLevel === 2 && point) return `${sentence(point)} How would you use this in your plan?`;
  return SUPPORT_FALLBACK_QUESTION;
}

export function avoidRepeatedQuestion(question: string, earlier: string[], phase: CasePhase, attempt: number) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const previous = new Set(earlier.map(normalize));
  if (!previous.has(normalize(question))) return question;
  return phase.exampleQuestions.find((candidate) => !previous.has(normalize(candidate)))
    ?? `For this attempt (${attempt}), which part of the current goal remains unclear, and what evidence would help you address it?`;
}
