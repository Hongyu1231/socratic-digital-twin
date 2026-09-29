import type { Classification, LearnerState, MemoryPatch, PhaseLearnerEvidence } from "@/lib/domain";

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
  const leftPhase = left.match(/^Phase (\d+):/i)?.[1];
  const rightPhase = right.match(/^Phase (\d+):/i)?.[1];
  // Evidence for one goal must not erase a different phase's open gap.
  // Unscoped legacy evidence is also intentionally kept separate from newer
  // phase-scoped evidence because its original phase cannot be recovered.
  if (leftPhase !== rightPhase && (leftPhase || rightPhase)) return false;
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
  scope?: { phaseOrder: number; phaseComplete: boolean },
) {
  if (scope) return mergePhaseEvidence(state, patch, classification, scope);
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

  return { strengths, weaknesses, previousErrors, phaseEvidence: state.phaseEvidence };
}

function flattenPhaseEvidence(phaseEvidence: Record<string, PhaseLearnerEvidence>) {
  const entries = Object.entries(phaseEvidence);
  const labelled = (key: string, text: string) => key === "legacy"
    ? text : `Phase ${key}: ${text.replace(/^Phase \d+:\s*/i, "")}`;
  return {
    strengths: uniqueRecent(entries.flatMap(([key, entry]) => entry.strengths.map((text) => labelled(key, text)))),
    weaknesses: uniqueRecent(entries.flatMap(([key, entry]) => entry.completed ? [] : entry.weaknesses.map((text) => labelled(key, text)))),
    previousErrors: uniqueRecent(entries.flatMap(([key, entry]) => entry.completed ? [] : entry.previousErrors.map((text) => labelled(key, text)))),
    phaseEvidence,
  };
}

const EVIDENCE_FIELDS = ["strengths", "weaknesses", "previousErrors"] as const;
type EvidenceField = typeof EVIDENCE_FIELDS[number];

function phaseEvidenceOwner(value: string) {
  const match = value.match(/^Phase (\d+):\s*(.+)$/i);
  if (!match) return null;
  return { key: String(Number(match[1])), value: match[2].trim() };
}

function emptyPhaseEvidence(): PhaseLearnerEvidence {
  return { strengths: [], weaknesses: [], previousErrors: [], completed: false };
}

function phaseKey(value: string) {
  return /^\d+$/.test(value) ? String(Number(value)) : null;
}

function unlabelledEvidence(value: string) {
  return phaseEvidenceOwner(value)?.value ?? value.trim();
}

function evidenceWithLegacy(state: LearnerState): Record<string, PhaseLearnerEvidence> {
  const entries: Record<string, PhaseLearnerEvidence> = {};
  const sourceEntries = Object.entries(state.phaseEvidence ?? {});

  // Copy the persisted ledger before migrating projections so reconciliation
  // remains pure and repeated reloads cannot accumulate duplicate evidence.
  for (const [sourceKey, source] of sourceEntries) {
    const key = sourceKey === "legacy" ? sourceKey : phaseKey(sourceKey) ?? sourceKey;
    entries[key] = {
      strengths: [...source.strengths],
      weaknesses: [...source.weaknesses],
      previousErrors: [...source.previousErrors],
      completed: source.completed,
    };
  }

  const addToPhase = (key: string, field: EvidenceField, value: string) => {
    const entry = entries[key] ?? (entries[key] = emptyPhaseEvidence());
    // A completed phase may retain its strengths, but its old gaps/errors are
    // historical and must never be resurrected by a flattened legacy view.
    if (entry.completed && field !== "strengths") return;
    const candidate = unlabelledEvidence(value);
    if (candidate && !entry[field].some((item) => unlabelledEvidence(item) === candidate)) {
      entry[field].push(candidate);
    }
  };

  // Explicit Phase N: prefixes carry enough provenance to migrate old
  // top-level evidence conservatively, including evidence already parked in
  // a legacy bucket by an earlier ledger version.
  for (const [sourceKey, source] of sourceEntries) {
    const numericSourceKey = phaseKey(sourceKey);
    for (const field of EVIDENCE_FIELDS) {
      for (const value of source[field]) {
        const owner = phaseEvidenceOwner(value);
        if (owner) {
          addToPhase(owner.key, field, owner.value);
        } else if (numericSourceKey) {
          addToPhase(numericSourceKey, field, value);
        }
      }
    }
  }

  const legacy = entries.legacy ?? emptyPhaseEvidence();
  for (const field of EVIDENCE_FIELDS) {
    const retained = legacy[field].filter((value) => !phaseEvidenceOwner(value));
    legacy[field] = retained;
  }

  // Top-level arrays are the persisted projection used by legacy sessions.
  // Backfill only values not already represented, while never re-adding a
  // prefixed gap/error to a phase whose ledger says it is complete.
  for (const field of EVIDENCE_FIELDS) {
    for (const value of state[field]) {
      const owner = phaseEvidenceOwner(value);
      if (owner) {
        addToPhase(owner.key, field, owner.value);
      } else if (!Object.values(entries).some((entry) =>
        entry[field].some((item) => unlabelledEvidence(item) === value.trim()),
      )) {
        legacy[field].push(value.trim());
      }
    }
  }

  if (EVIDENCE_FIELDS.some((field) => legacy[field].length)) entries.legacy = legacy;
  else if (entries.legacy && !sourceEntries.some(([key]) => key === "legacy")) delete entries.legacy;
  return entries;
}

function mergePhaseEvidence(
  state: LearnerState,
  patch: MemoryPatch,
  classification: Classification,
  scope: { phaseOrder: number; phaseComplete: boolean },
): Pick<LearnerState, "strengths" | "weaknesses" | "previousErrors" | "phaseEvidence"> {
  // Preserve unscoped legacy feedback instead of guessing which goal it came from.
  const phaseEvidence = evidenceWithLegacy(state);
  const key = String(scope.phaseOrder);
  const previous = phaseEvidence[key] ?? { strengths: [], weaknesses: [], previousErrors: [], completed: false };
  // "Correct" means the rubric is fulfilled, but a scripted teaching move may
  // still block progression. Close this phase's gaps only on actual completion.
  const completed = classification === "correct" && scope.phaseComplete;
  const weaknesses = completed ? [] : uniqueRecent([...previous.weaknesses, ...patch.addWeaknesses]);
  const previousErrors = completed ? [] : uniqueRecent([...previous.previousErrors, ...patch.addErrors]);
  const strengths = uniqueRecent([...previous.strengths, ...patch.addStrengths])
    .filter((strength) => ![...weaknesses, ...previousErrors].some((gap) => describesSameConcept(strength, gap)));
  phaseEvidence[key] = {
    strengths,
    weaknesses,
    previousErrors,
    completed,
  };
  return flattenPhaseEvidence(phaseEvidence);
}

export function reconcileLearnerStateEvidence(state: LearnerState): LearnerState {
  if (state.phaseEvidence) return { ...state, ...flattenPhaseEvidence(evidenceWithLegacy(state)) };
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
