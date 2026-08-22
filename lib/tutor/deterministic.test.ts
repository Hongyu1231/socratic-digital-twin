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
    expect(result.nextQuestion).toBe(phase.exampleQuestions.at(-1));
  });

  it("uses the classification strategy to select a different kind of question", async () => {
    const [correct, partial, vague, wrong] = await Promise.all([
      tutor.evaluate({ phase, answer: "The unerupted canine and eruption asymmetry are concerning because the timing at this age raises the possibility of impaction.", state, attempt: 1 }),
      tutor.evaluate({ phase, answer: "The canine is unerupted, which may represent delayed eruption.", state, attempt: 1 }),
      tutor.evaluate({ phase, answer: "I am not sure.", state, attempt: 1 }),
      tutor.evaluate({ phase, answer: "The patient needs antibiotics because pain always means infection in this situation.", state, attempt: 1 }),
    ]);

    expect(correct).toMatchObject({ strategy: "reflect", nextQuestion: "What assumption in that reasoning would be most important to verify?" });
    expect(partial).toMatchObject({ strategy: "probe", nextQuestion: phase.exampleQuestions[0] });
    expect(vague).toMatchObject({ strategy: "clarify", nextQuestion: "Which specific case finding would make your answer clinically meaningful?" });
    expect(wrong).toMatchObject({ strategy: "challenge", nextQuestion: "Which finding in this case most directly conflicts with your current conclusion?" });
  });
});
