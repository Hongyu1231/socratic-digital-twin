import type { CasePhase, LearnerState, TutorEvaluationResult, TutorStrategy } from "@/lib/domain";

interface EvaluateInput {
  phase: CasePhase;
  answer: string;
  state: LearnerState;
  attempt: number;
}

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");

const phaseKeywords: Record<number, string[][]> = {
  1: [["unerupted", "not erupted", "delayed"], ["asymmetry", "contralateral"], ["impacted", "impaction"], ["age", "timing"]],
  2: [["palpation", "palpate", "clinical"], ["panoramic", "opg", "radiograph"], ["parallax", "tube shift"], ["position", "buccal", "palatal"], ["cbct", "three-dimensional"]],
  3: [["resorption", "incisor root"], ["space", "crowding"], ["angulation", "position"], ["age", "development"], ["prognosis", "risk"]],
  4: [["extract", "extraction", "deciduous canine"], ["space", "orthodontic"], ["exposure", "traction"], ["monitor", "observe"], ["remove", "surgery"]],
  5: [["evidence", "finding"], ["uncertain", "uncertainty"], ["assumption", "bias"], ["alternative", "revise"], ["reflect", "reassess"]],
};

function keywordMatches(phase: CasePhase, answer: string) {
  const text = normalise(answer);
  return (phaseKeywords[phase.order] ?? []).filter((group) =>
    group.some((keyword) => text.includes(keyword)),
  ).length;
}

function strategyFor(classification: TutorEvaluationResult["classification"], attempt: number): TutorStrategy {
  if (attempt >= 3) return "scaffold";
  if (classification === "wrong") return "challenge";
  if (classification === "vague") return "clarify";
  if (classification === "correct") return "reflect";
  return "probe";
}

export class DeterministicTutor {
  readonly mode = "deterministic" as const;

  async evaluate({ phase, answer, attempt }: EvaluateInput): Promise<TutorEvaluationResult> {
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
    const nextQuestionIndex = Math.min(attempt - 1, phase.exampleQuestions.length - 1);
    const fallbackQuestion = phase.exampleQuestions[Math.max(0, nextQuestionIndex)];
    const nextQuestion =
      attempt >= 3
        ? `Before we move on, name one piece of evidence you would still want to test in ${phase.title.toLowerCase()}.`
        : classification === "correct"
          ? `What assumption in that reasoning would be most important to verify?`
          : fallbackQuestion;

    const gap =
      classification === "correct"
        ? "The answer is well supported; the remaining opportunity is to make the key assumption explicit."
        : classification === "partial"
          ? `The answer identifies a relevant feature but does not yet connect enough evidence to the goal: ${phase.goal}`
          : classification === "vague"
            ? "The answer does not commit to a specific finding or explain why it matters."
            : `The reasoning is not yet anchored to the phase rubric: ${phase.rubric.slice(0, 3).join(", ")}.`;

    return {
      classification,
      confidence: classification === "correct" || classification === "vague" ? 0.82 : 0.74,
      reasoningGap: gap,
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
