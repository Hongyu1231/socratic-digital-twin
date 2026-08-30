import { describe, expect, it } from "vitest";

import type { Evaluation } from "@/lib/domain";
import {
  buildStudentVisibleTutorReply,
  EXPLICIT_CORRECTION_CONFIDENCE,
  shouldExplicitlyCorrect,
  WRONG_ANSWER_BASIS_PROBE,
} from "@/lib/tutor/correction-policy";

function evaluation(
  classification: Evaluation["classification"],
  confidence: number,
  phaseOrder = 3,
  misconceptionKey = classification === "wrong" ? "root-resorption-claim" : null,
): Evaluation {
  return {
    id: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    classification,
    confidence,
    reasoningGap: "The claim conflicts with the supplied rubric.",
    misconceptionKey,
    strategy: "challenge",
    phaseComplete: false,
    feedback: "The claim is not supported.",
    phaseOrder,
    attempt: 1,
    createdAt: new Date().toISOString(),
  };
}

const current = {
  classification: "wrong" as const,
  confidence: EXPLICIT_CORRECTION_CONFIDENCE,
  misconceptionKey: "root-resorption-claim",
  nextQuestion: "Which case evidence would you use to reassess that claim?",
};

describe("wrong-answer correction policy", () => {
  it("probes after the first high-confidence wrong classification", () => {
    expect(buildStudentVisibleTutorReply(current, [], 3)).toBe(WRONG_ANSWER_BASIS_PROBE);
  });

  it("preserves a specific authored probe after the first high-confidence wrong classification", () => {
    expect(buildStudentVisibleTutorReply(current, [], 3, { hasScriptedMove: true })).toBe(current.nextQuestion);
  });

  it("plainly corrects after two consecutive high-confidence wrong classifications", () => {
    const reply = buildStudentVisibleTutorReply(current, [evaluation("wrong", 0.94)], 3);
    expect(reply).toBe(`That statement is incorrect. ${current.nextQuestion}`);
  });

  it.each(["partial", "vague", "correct"] as const)("never fires for a current %s classification", (classification) => {
    expect(shouldExplicitlyCorrect({ ...current, classification }, [evaluation("wrong", 0.96)], 3)).toBe(false);
  });

  it("does not fire on low confidence, a different phase, or a non-consecutive wrong label", () => {
    expect(shouldExplicitlyCorrect({ ...current, confidence: 0.84 }, [evaluation("wrong", 0.96)], 3)).toBe(false);
    expect(shouldExplicitlyCorrect(current, [evaluation("wrong", 0.96, 2)], 3)).toBe(false);
    expect(shouldExplicitlyCorrect(current, [evaluation("wrong", 0.96), evaluation("partial", 0.92)], 3)).toBe(false);
  });

  it("treats a different misconception in the same phase as a new first strike", () => {
    const previous = evaluation("wrong", 0.96, 3, "unsafe-traction-vector");
    expect(shouldExplicitlyCorrect(current, [previous], 3)).toBe(false);
    expect(buildStudentVisibleTutorReply(current, [previous], 3)).toBe(WRONG_ANSWER_BASIS_PROBE);
  });
});
