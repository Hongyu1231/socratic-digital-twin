import type { Classification, LearnerState, MemoryPatch } from "@/lib/domain";

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "compared", "compare", "did", "does", "for", "from",
  "has", "have", "identified", "in", "is", "it", "need", "needed", "needs", "of", "on", "should",
  "the", "their", "to", "was", "with", "would", "phase", "reasoning",
]);

const uniqueRecent = (values: string[], limit = 8) =>
  [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(-limit);

function conceptTokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

export function describesSameConcept(left: string, right: string) {
  const a = conceptTokens(left);
  const b = conceptTokens(right);
  if (!a.size || !b.size) return false;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap >= 2 && overlap / Math.min(a.size, b.size) >= 0.6;
}

export function mergeLearnerEvidence(
  state: LearnerState,
  patch: MemoryPatch,
  classification: Classification,
) {
  let strengths = uniqueRecent([...state.strengths, ...patch.addStrengths]);
  let weaknesses = uniqueRecent([...state.weaknesses, ...patch.addWeaknesses]);
  let previousErrors = uniqueRecent([...state.previousErrors, ...patch.addErrors]);

  for (const strength of patch.addStrengths) {
    weaknesses = weaknesses.filter((item) => !describesSameConcept(strength, item));
    previousErrors = previousErrors.filter((item) => !describesSameConcept(strength, item));
  }

  if (classification !== "correct") {
    for (const gap of [...patch.addWeaknesses, ...patch.addErrors]) {
      strengths = strengths.filter((item) => !describesSameConcept(gap, item));
    }
  }

  weaknesses = weaknesses.filter((weakness) =>
    !strengths.some((strength) => describesSameConcept(strength, weakness)),
  );
  previousErrors = previousErrors.filter((error) =>
    !strengths.some((strength) => describesSameConcept(strength, error)),
  );

  return { strengths, weaknesses, previousErrors };
}

export function reconcileLearnerStateEvidence(state: LearnerState): LearnerState {
  const evidence = mergeLearnerEvidence(state, {
    addErrors: [],
    addStrengths: [],
    addWeaknesses: [],
    masteryDelta: 0,
  }, "correct");
  return { ...state, ...evidence };
}

export function removeSummaryContradictions(strengths: string[], weaknesses: string[]) {
  const cleanStrengths = uniqueRecent(strengths, 5);
  const cleanWeaknesses = uniqueRecent(weaknesses, 5).filter((weakness) =>
    !cleanStrengths.some((strength) => describesSameConcept(strength, weakness)),
  );
  return { strengths: cleanStrengths, weaknesses: cleanWeaknesses };
}
