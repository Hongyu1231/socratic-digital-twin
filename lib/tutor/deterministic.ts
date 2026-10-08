import { CRITERION_EVIDENCE_MAX_LENGTH, type CasePhase, type CriterionEvidence, type TutorEvaluateInput, type TutorEvaluationResult, type TutorStrategy } from "@/lib/domain";
import { phaseCriteria, rubricText } from "@/lib/tutor/criteria";

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");

const KEYWORD_STOP_WORDS = new Set(["about", "after", "against", "also", "and", "before", "case", "clinical", "from", "goal", "into", "more", "phase", "should", "that", "their", "this", "through", "with"]);

function rubricKeywordGroups(phase: CasePhase) {
  return phase.rubric.map((criterion) => normalise(rubricText(criterion)).split(/\s+/)
    .filter((word) => word.length >= 5 && !KEYWORD_STOP_WORDS.has(word))
    .slice(0, 8))
    .filter((group) => group.length);
}

function keywordMatches(phase: CasePhase, answer: string) {
  const text = normalise(answer);
  return rubricKeywordGroups(phase).filter((group) =>
    group.some((keyword) => text.includes(keyword)),
  ).length;
}

function criteriaForAnswer(phase: CasePhase, answer: string, classification: TutorEvaluationResult["classification"]): CriterionEvidence[] {
  const quote = answer.trim().slice(0, CRITERION_EVIDENCE_MAX_LENGTH);
  if (!quote) return [];

  const criteria = phaseCriteria(phase);
  // The deterministic adapter deliberately does not infer clinician-authored
  // criteria from keywords: a negation or incidental mention is not reliable
  // evidence. Preserve the historical all-string compatibility path only,
  // while retaining the real answer quote in the structured representation.
  if (phase.acceptedExtras?.length || !phase.rubric.every((item) => typeof item === "string") || classification !== "correct") return [];
  return criteria.map(({ id }) => ({ id, evidence: quote }));
}

function strategyFor(classification: TutorEvaluationResult["classification"], attempt: number): TutorStrategy {
  if (classification === "correct") return "reflect";
  if (attempt >= 3) return "scaffold";
  if (classification === "wrong") return "challenge";
  if (classification === "vague") return "clarify";
  return "probe";
}

function questionFor(strategy: TutorStrategy, phase: CasePhase, attempt: number) {
  const questions = phase.exampleQuestions.length ? phase.exampleQuestions : [phase.starterQuestion];
  const questionIndex = Math.min(Math.max(0, attempt - 1), questions.length - 1);
  if (strategy === "challenge") return "Which finding in this case most directly conflicts with your current conclusion?";
  if (strategy === "clarify") return "Which specific case finding would make your answer clinically meaningful?";
  if (strategy === "reflect") return "What assumption in that reasoning would be most important to verify?";
  if (strategy === "scaffold") return questions.at(-1) ?? phase.starterQuestion;
  return questions[questionIndex];
}

export class DeterministicTutor {
  readonly mode = "deterministic" as const;

  async evaluate({ phase, answer, attempt }: TutorEvaluateInput): Promise<TutorEvaluationResult> {
    const matches = keywordMatches(phase, answer);
    const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
    const classification =
      matches >= 2 && wordCount >= 12
        ? "correct"
        : matches >= 1
          ? "partial"
          : wordCount < 8
            ? "vague"
            : "wrong";
    const strategy = strategyFor(classification, attempt);
    const nextQuestion = questionFor(strategy, phase, attempt);

    // These notes can reach the learner through the summary's weakness list,
    // so they stay generic: no phase goal, criterion or rubric text.
    const gap =
      classification === "correct"
        ? "The answer is well supported; the remaining opportunity is to make the key assumption explicit."
        : classification === "partial"
          ? "The answer names a relevant feature but does not yet link enough evidence to it."
          : classification === "vague"
            ? "The answer does not commit to a specific finding or explain why it matters."
            : "The reasoning is not yet tied to the findings in this case.";

    return {
      classification,
      // Keyword matching is not reliable evidence for clinician-authored IDs.
      // Let the support ladder handle explicit-criterion cases when offline.
      criteriaMet: criteriaForAnswer(phase, answer, classification),
      targetCriterionId: phaseCriteria(phase)[0]?.id ?? null,
      confidence: classification === "correct" || classification === "vague" ? 0.82 : 0.74,
      reasoningGap: gap,
      misconceptionKey: classification === "wrong"
        ? `rubric:${normalise(rubricText(phase.rubric[0] ?? "unsupported reasoning")).trim().replace(/\s+/g, "-").slice(0, 100)}`
        : null,
      strategy,
      feedback:
        classification === "correct"
          ? "You connected more than one relevant finding to your conclusion."
          : "There is a useful starting point here, but the evidential link needs to be more explicit.",
      nextQuestion,
      memoryPatch: {
        addErrors: classification === "wrong" ? [`Phase ${phase.order}: reasoning not anchored to clinical evidence`] : [],
        addStrengths: classification === "correct" ? [`Phase ${phase.order}: integrates multiple relevant findings`] : [],
        addWeaknesses:
          classification === "partial" || classification === "vague"
            ? [`Phase ${phase.order}: ${gap}`]
            : [],
        masteryDelta: classification === "correct" ? 0.4 : classification === "partial" ? 0.2 : classification === "vague" ? 0.05 : -0.1,
      },
      source: "deterministic",
    };
  }
}
