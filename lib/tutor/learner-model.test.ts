import { describe, expect, it } from "vitest";
import type { LearnerState } from "@/lib/domain";
import { mergeLearnerEvidence, removeSummaryContradictions } from "@/lib/tutor/learner-model";

const state: LearnerState = {
  sessionId: crypto.randomUUID(),
  currentGoal: "Compare management",
  previousErrors: [],
  strengths: ["Compared permanent-canine extraction with orthodontic retention"],
  weaknesses: [],
  nextStrategy: "probe",
  phaseAttempts: {},
  mastery: {},
  version: 1,
  updatedAt: new Date().toISOString(),
};

describe("learner evidence reconciliation", () => {
  it("does not keep a concept as both a strength and a new weakness", () => {
    const merged = mergeLearnerEvidence(state, {
      addErrors: [],
      addStrengths: [],
      addWeaknesses: ["Needs to compare permanent-canine extraction with orthodontic retention"],
      masteryDelta: 0,
    }, "partial");
    expect(merged.strengths).toEqual([]);
    expect(merged.weaknesses).toHaveLength(1);
  });

  it("filters contradictions from generated summaries", () => {
    const result = removeSummaryContradictions(
      ["Compared permanent-canine extraction with orthodontic retention"],
      ["Needs to compare permanent-canine extraction with orthodontic retention", "Clarify CBCT justification"],
    );
    expect(result.weaknesses).toEqual(["Clarify CBCT justification"]);
  });
});
