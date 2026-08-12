import { describe, expect, it } from "vitest";
import { DeterministicTutor } from "@/lib/tutor/deterministic";
import { impactedCanineCase } from "@/lib/seed";
import type { LearnerState } from "@/lib/domain";

const state: LearnerState = {
  sessionId: crypto.randomUUID(), currentGoal: "goal", previousErrors: [], strengths: [], weaknesses: [],
  nextStrategy: "probe", phaseAttempts: { "1": 0 }, mastery: { "1": 0 }, version: 1, updatedAt: new Date().toISOString(),
};

describe("deterministic tutor", () => {
  const tutor = new DeterministicTutor();
  const phase = impactedCanineCase.phases[0];
  it.each([
    ["The unerupted canine and eruption asymmetry are concerning because the timing at this age raises the possibility of impaction.", "correct"],
    ["The canine is unerupted, which may represent delayed eruption.", "partial"],
    ["I am not sure.", "vague"],
    ["The patient needs antibiotics because pain always means infection in this situation.", "wrong"],
  ] as const)("classifies %s as %s", async (answer, expected) => {
    const result = await tutor.evaluate({ phase, answer, state, attempt: 1 });
    expect(result.classification).toBe(expected);
    expect(result.nextQuestion.endsWith("?")).toBe(true);
  });
  it("switches to scaffolding on a third attempt", async () => {
    const result = await tutor.evaluate({ phase, answer: "Not sure.", state, attempt: 3 });
    expect(result.strategy).toBe("scaffold");
  });
});
