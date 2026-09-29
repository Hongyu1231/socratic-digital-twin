import { describe, expect, it } from "vitest";

import type { CasePhase, PhaseTutorProgress, TutorEvaluationResult } from "@/lib/domain";
import { normalizeCriterionTags, phaseCriteria } from "@/lib/tutor/criteria";
import { avoidRepeatedQuestion, progressPhase, supportQuestion } from "@/lib/tutor/progression";

const phase = (overrides: Partial<CasePhase> = {}): CasePhase => ({
  id: "phase-1",
  caseId: "case-1",
  order: 1,
  title: "Observe",
  goal: "Describe the supplied evidence before deciding.",
  rubric: [
    { id: "observation", text: "States a specific observation", revealText: "State the visible observation." },
    { id: "evidence", text: "Names the supporting evidence", revealText: "Name the supporting record." },
  ],
  starterQuestion: "What do you notice?",
  exampleQuestions: ["Which record supports that observation?"],
  ...overrides,
});

const evaluation = (overrides: Partial<TutorEvaluationResult> = {}): TutorEvaluationResult => ({
  classification: "partial",
  confidence: 0.8,
  reasoningGap: "The answer is incomplete.",
  misconceptionKey: null,
  strategy: "probe",
  feedback: "What evidence supports that?",
  nextQuestion: "What evidence supports that?",
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: [], masteryDelta: 0 },
  source: "deterministic",
  ...overrides,
});

const progress = (overrides: Partial<PhaseTutorProgress> = {}): PhaseTutorProgress => ({
  criteriaMet: [],
  bestClassification: "wrong",
  noProgressCount: 0,
  supportLevel: 0,
  awaitingApplication: false,
  completedWithSupport: false,
  completed: false,
  ...overrides,
});

describe("phase criteria normalization", () => {
  it("preserves explicit criterion IDs and gives legacy strings stable compatibility IDs", () => {
    expect(phaseCriteria(phase())).toEqual([
      { id: "observation", text: "States a specific observation", revealText: "State the visible observation." },
      { id: "evidence", text: "Names the supporting evidence", revealText: "Name the supporting record." },
    ]);
    expect(phaseCriteria(phase({ rubric: ["first observation", "supporting evidence"] }))).toEqual([
      { id: "r1", text: "first observation" },
      { id: "r2", text: "supporting evidence" },
    ]);
  });

  it("sanitizes unknown tags without discarding independently valid tags", () => {
    const result = normalizeCriterionTags(evaluation({
      targetCriterionId: "observation",
      criteriaMet: ["observation", "unknown", "observation"],
      acknowledgement: "That is a useful observation.",
    }), phase());

    expect(result.targetCriterionId).toBe("observation");
    expect(result.criteriaMet).toEqual(["observation"]);
    expect(result.acknowledgement).toBe("That is a useful observation.");

    const invalidTarget = normalizeCriterionTags(evaluation({
      targetCriterionId: "not-a-criterion",
      criteriaMet: ["evidence"],
      acknowledgement: "Evidence is still needed.",
    }), phase());
    expect(invalidTarget.targetCriterionId).toBeNull();
    expect(invalidTarget.criteriaMet).toEqual(["evidence"]);
    expect(invalidTarget.acknowledgement).toBe("Evidence is still needed.");
  });

  it("removes an invalid acknowledgement independently of valid criterion tags", () => {
    const result = normalizeCriterionTags(evaluation({
      targetCriterionId: "evidence",
      criteriaMet: ["observation", "evidence"],
      acknowledgement: "Can you explain why?",
    }), phase());

    expect(result.acknowledgement).toBeUndefined();
    expect(result.targetCriterionId).toBe("evidence");
    expect(result.criteriaMet).toEqual(["observation", "evidence"]);
  });

  it("does not infer explicit criteria from a correct classification, while retaining legacy compatibility", () => {
    const explicit = normalizeCriterionTags(evaluation({ classification: "correct", criteriaMet: undefined }), phase());
    expect(explicit.criteriaMet).toEqual([]);

    const legacy = normalizeCriterionTags(
      evaluation({ classification: "correct", criteriaMet: undefined }),
      phase({ rubric: ["first observation", "supporting evidence"] }),
    );
    expect(legacy.criteriaMet).toEqual(["r1", "r2"]);
  });
});

describe("phase progression", () => {
  it("does not let a wrong answer earn criteria", () => {
    const result = progressPhase(
      phase(),
      undefined,
      evaluation({ classification: "wrong", criteriaMet: ["observation", "evidence"] }),
      1,
      false,
    );

    expect(result.state.criteriaMet).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it("requires all criteria across the union of correct answers before advancing", () => {
    const first = progressPhase(
      phase(),
      undefined,
      evaluation({ classification: "correct", criteriaMet: ["observation"] }),
      1,
      false,
    );
    expect(first.state.criteriaMet).toEqual(["observation"]);
    expect(first.complete).toBe(false);

    const second = progressPhase(
      phase(),
      first.state,
      evaluation({ classification: "correct", criteriaMet: ["evidence"] }),
      2,
      false,
    );
    expect(second.state.criteriaMet).toEqual(["observation", "evidence"]);
    expect(second.complete).toBe(true);
  });

  it("resets only on genuine progress, so vague/partial oscillation eventually escalates", () => {
    const vague = progressPhase(phase(), undefined, evaluation({ classification: "vague", criteriaMet: [] }), 1, false);
    expect(vague.state.noProgressCount).toBe(0);

    const partial = progressPhase(phase(), vague.state, evaluation({ classification: "partial", criteriaMet: [] }), 2, false);
    expect(partial.state.noProgressCount).toBe(0);

    const vagueAgain = progressPhase(phase(), partial.state, evaluation({ classification: "vague", criteriaMet: [] }), 3, false);
    expect(vagueAgain.state.noProgressCount).toBe(1);
    const partialAgain = progressPhase(phase(), vagueAgain.state, evaluation({ classification: "partial", criteriaMet: [] }), 4, false);
    expect(partialAgain.state.noProgressCount).toBe(0);
    expect(partialAgain.state.supportLevel).toBe(1);
    expect(partialAgain.escalated).toBe(true);
  });

  it("escalates after two no-progress turns at each support level", () => {
    const first = progressPhase(phase(), undefined, evaluation({ classification: "wrong" }), 1, false);
    expect(first.state.supportLevel).toBe(0);
    const levelOne = progressPhase(phase(), first.state, evaluation({ classification: "wrong" }), 2, false);
    expect(levelOne.state.supportLevel).toBe(1);
    expect(levelOne.state.noProgressCount).toBe(0);

    const third = progressPhase(phase(), levelOne.state, evaluation({ classification: "wrong" }), 3, false);
    expect(third.state.supportLevel).toBe(1);
    const levelTwo = progressPhase(phase(), third.state, evaluation({ classification: "wrong" }), 4, false);
    expect(levelTwo.state.supportLevel).toBe(2);
    expect(levelTwo.state.awaitingApplication).toBe(true);
    expect(levelTwo.state.noProgressCount).toBe(0);
  });

  it("forces the reveal ceiling even when a scripted move blocks advancement", () => {
    const result = progressPhase(
      phase({ phaseCeiling: 3 }),
      undefined,
      evaluation({ classification: "correct", criteriaMet: ["observation", "evidence"] }),
      3,
      true,
    );

    expect(result.complete).toBe(false);
    expect(result.state.supportLevel).toBe(2);
    expect(result.state.awaitingApplication).toBe(true);
  });

  it("keeps a reveal pending for application, then completes with support regardless of the application grade", () => {
    const reveal = progressPhase(
      phase(),
      progress({ supportLevel: 2 }),
      evaluation({ classification: "partial", criteriaMet: [] }),
      2,
      false,
    );
    expect(reveal.complete).toBe(false);
    expect(reveal.state.awaitingApplication).toBe(true);
    expect(reveal.state.completedWithSupport).toBe(false);

    const application = progressPhase(
      phase(),
      reveal.state,
      evaluation({ classification: "wrong", criteriaMet: [] }),
      3,
      false,
    );
    expect(application.complete).toBe(true);
    expect(application.state.completed).toBe(true);
    expect(application.state.completedWithSupport).toBe(true);
    expect(application.state.awaitingApplication).toBe(false);
  });

  it("does not mark an ordinary correct answer as support-completed", () => {
    const result = progressPhase(
      phase(),
      undefined,
      evaluation({ classification: "correct", criteriaMet: ["observation", "evidence"] }),
      1,
      false,
    );

    expect(result.complete).toBe(true);
    expect(result.state.completedWithSupport).toBe(false);
  });
});

describe("support and repeated-question safeguards", () => {
  it("asks for the first unmet criterion at reveal level", () => {
    const question = supportQuestion(phase(), progress({ supportLevel: 2, criteriaMet: ["observation"] }));
    expect(question).toContain("Name the supporting record.");
    expect(question).toContain("How would you apply this point");
    expect(question).toContain("?");
  });

  it("uses an unused example or a deterministic fallback for an exact duplicate", () => {
    const current = "Which finding matters most?";
    const next = avoidRepeatedQuestion(current, [current], phase({ exampleQuestions: ["Which record supports that observation?"] }), 4);
    expect(next).toBe("Which record supports that observation?");

    const fallback = avoidRepeatedQuestion(
      current,
      [current, "Which record supports that observation?"],
      phase({ exampleQuestions: ["Which record supports that observation?"] }),
      4,
    );
    expect(fallback).not.toBe(current);
    expect(fallback).not.toBe("Which record supports that observation?");
    expect(fallback).toContain("For this attempt (4)");
  });
});
