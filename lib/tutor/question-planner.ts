import type { Classification, LearnerState, TutorMove } from "@/lib/domain";
import type { CasePhase } from "@/lib/domain";

const normalise = (value: string) => value
  .toLowerCase()
  .replace(/[’']/g, "'")
  .replace(/[^a-z0-9\s'-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const includesPhrase = (text: string, phrase: string) => text.includes(normalise(phrase));

function matchesMove(
  move: TutorMove,
  answer: string,
  state: LearnerState,
  classification: Classification,
) {
  const text = normalise(answer);
  const previousErrors = normalise(state.previousErrors.join(" "));
  if (move.classifications?.length && !move.classifications.includes(classification)) return false;
  if (move.answerIncludesAny?.length && !move.answerIncludesAny.some((item) => includesPhrase(text, item))) return false;
  if (move.answerIncludesAll?.length && !move.answerIncludesAll.every((item) => includesPhrase(text, item))) return false;
  if (move.answerOmitsAll?.length && !move.answerOmitsAll.every((item) => !includesPhrase(text, item))) return false;
  if (move.previousErrorIncludesAny?.length
    && !move.previousErrorIncludesAny.some((item) => includesPhrase(previousErrors, item))) return false;
  return true;
}

export function selectTutorMove(
  phase: CasePhase,
  answer: string,
  state: LearnerState,
  classification: Classification,
) {
  const used = new Set(state.usedTutorMoves ?? []);
  return phase.tutorMoves?.find((move) =>
    (!used.has(move.id) || Boolean(move.recordError && move.blockAdvancement))
      && matchesMove(move, answer, state, classification),
  );
}
