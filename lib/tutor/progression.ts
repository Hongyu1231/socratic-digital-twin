import type { CasePhase, Classification, PhaseTutorProgress, TutorEvaluationResult } from "@/lib/domain";
import { criterionIds, phaseCriteria } from "@/lib/tutor/criteria";
import { hasAskedQuestion } from "@/lib/tutor/questions";

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
export const SUPPORT_FALLBACK_QUESTION = "One possible plan is to act before checking the available records. What might that plan miss?";

export class SupportFallbackUnavailableError extends Error {
  readonly retryable = true;
  readonly code = "HELP_GENERATION_RETRYABLE";
  constructor() {
    super("A short, new support question is temporarily unavailable. Please try again.");
    this.name = "SupportFallbackUnavailableError";
  }
}

/** The criterion a step-up is about: the first unmet one. */
export function supportTarget(phase: CasePhase, progress: PhaseTutorProgress) {
  return phaseCriteria(phase).find((item) => !progress.criteriaMet.includes(item.id)) ?? phaseCriteria(phase)[0];
}

/** Fixed step-up wording, used when the model cannot write it. Never contains the phase goal. */
export function supportQuestion(phase: CasePhase, progress: PhaseTutorProgress, askedQuestions: string[] = []) {
  const criterion = supportTarget(phase, progress);
  const point = criterion?.revealText ?? criterion?.text;
  if (progress.supportLevel === 2 && point) {
    const question = ["How would you use this in your plan?", "What would this change in your plan?", "Which part of your plan depends on this finding?", "How would you explain this finding to the patient?", `What does this change in ${phase.title.toLowerCase()}?`]
      .find(question => !hasAskedQuestion(question, askedQuestions));
    const content = question ? `${sentence(point)} ${question}` : "";
    // Never truncate an authored clinical finding or discard its qualifiers to
    // meet the UI word budget. A failure commits no answer/Help state instead.
    if (!content || content.split(/\s+/).length > 60) throw new SupportFallbackUnavailableError();
    return content;
  }
  const content = [SUPPORT_FALLBACK_QUESTION,
    "One possible plan is to decide before resolving an important uncertainty. Which assumption in that plan would you check?",
    "One possible plan is to choose an option before weighing alternatives. What other option would you consider?",
    "One possible plan is to accept the first reading of a record. Which part of that record would you check again?",
    "One possible plan is to decide from the first finding. What evidence might change that decision?",
    "One possible plan assumes the available evidence is complete. Which limitation might matter here?",
    "One possible plan is to act before discussing the patient's concerns. What would you ask the patient?",
    "One possible plan is to choose a procedure before agreeing its purpose. Which aim should guide that choice?",
  ].find(content => !hasAskedQuestion(content, askedQuestions));
  if (!content) throw new SupportFallbackUnavailableError();
  return content;
}

export function avoidRepeatedQuestion(question: string, earlier: string[], phase: CasePhase, attempt: number) {
  if (!hasAskedQuestion(question, earlier)) return question;
  return phase.exampleQuestions.find((candidate) => !hasAskedQuestion(candidate, earlier))
    ?? ["Which remaining point would you explore next?", "What would help you resolve the remaining uncertainty?", `In ${phase.title}, which finding would you check next?`]
      .find(candidate => !hasAskedQuestion(candidate, earlier))
    ?? ["Which part of this are you still unsure about?"].find(candidate => !hasAskedQuestion(candidate, earlier))
    ?? `For this attempt (${attempt}), what else would help you explain your decision?`;
}
