import { describe, expect, it } from "vitest";
import type { CasePhase, PhaseTutorProgress, TutorEvaluationResult } from "@/lib/domain";
import { normalizeCriterionTags } from "@/lib/tutor/criteria";
import { progressPhase, supportTarget } from "@/lib/tutor/progression";

// Python content tests assert these authored IDs stay in required/bonus lists.
// These tests cover the independent runtime boundary consuming those lists.
const phase: CasePhase = {
  id: "phase-6", caseId: "case-1", order: 6, title: "Review the plan", goal: "Discuss execution challenges.",
  rubric: ["p6-anticipated-outcome", "p6-checkpoint-reconsideration", "p6-evidence-tradeoffs"]
    .map(id => ({ id, text: `Required execution reasoning: ${id}` })),
  acceptedExtras: [{ id: "p6-extra-overbite-control", text: "Optional overbite discussion." }],
  starterQuestion: "What challenges do you anticipate?", exampleQuestions: ["What would make you review the plan?"],
  tutorMoves: [], phaseCeiling: 5,
};
const result = (patch: Partial<TutorEvaluationResult> = {}): TutorEvaluationResult => ({
  classification: "partial", confidence: 0.8, reasoningGap: "", misconceptionKey: null,
  strategy: "probe", feedback: "", nextQuestion: "Which challenge remains?", criteriaMet: [],
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: [], masteryDelta: 0 },
  source: "deterministic", ...patch,
});
const previous = (criteriaMet: string[] = []): PhaseTutorProgress => ({
  criteriaMet, bestClassification: "wrong", noProgressCount: 1, supportLevel: 0,
  awaitingApplication: false, completedWithSupport: false, completed: false,
});

describe("Jessica bonus decisions at the runtime boundary", () => {
  it("completes phase six with all required evidence and no overbite discussion", () => {
    const evaluated = normalizeCriterionTags(result({
      criteriaMet: phase.rubric.map(item => typeof item === "string" ? item : item.id),
      answerCriterionId: "p6-evidence-tradeoffs",
    }), phase);
    expect(progressPhase(phase, undefined, evaluated, 1, false).complete).toBe(true);
  });

  it("does not count optional overbite IDs towards an unmet required challenge", () => {
    const evaluated = normalizeCriterionTags(result({
      criteriaMet: ["p6-checkpoint-reconsideration", "p6-extra-overbite-control"],
      answerCriterionId: "p6-extra-overbite-control", targetCriterionId: "p6-extra-overbite-control",
    }), phase);
    const progress = progressPhase(phase, previous(["p6-anticipated-outcome", "p6-extra-overbite-control"]), evaluated, 1, false);
    expect(progress.complete).toBe(false);
    expect(progress.state.criteriaMet).toEqual(["p6-anticipated-outcome", "p6-checkpoint-reconsideration"]);
    expect(evaluated.answerCriterionId).toBeNull();
    expect(evaluated.targetCriterionId).toBeNull();
    expect(supportTarget(phase, progress.state)?.id).toBe("p6-evidence-tradeoffs");
  });

  it("does not let a bonus-only quality-label improvement postpone support", () => {
    const evaluated = normalizeCriterionTags(result({
      classification: "correct", answerCriterionId: "p6-extra-overbite-control", criteriaMet: ["p6-extra-overbite-control"],
    }), phase);
    const progress = progressPhase(phase, previous(), evaluated, 2, false);
    expect(progress.complete).toBe(false);
    expect(progress.state.criteriaMet).toEqual([]);
    expect(progress.state.bestClassification).toBe("wrong");
    expect(progress.state.supportLevel).toBe(1);
  });
});
