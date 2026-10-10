import { beforeEach, describe, expect, it, vi } from "vitest";

const parseMock = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { parse: parseMock };
  },
}));

import { ClaudeTutor } from "@/lib/tutor/claude";
import { impactedCanineCase } from "@/lib/seed";
import type { LearnerState } from "@/lib/domain";

const state: LearnerState = {
  sessionId: crypto.randomUUID(), currentGoal: "goal", previousErrors: [], strengths: [], weaknesses: [],
  nextStrategy: "probe", phaseAttempts: { "1": 0 }, mastery: { "1": 0 }, version: 1, updatedAt: new Date().toISOString(),
};
const parsedOutput = {
  acknowledgement: "You identified the unerupted canine.",
  targetCriterionId: null,
  answerCriterionId: null,
  criteriaMet: [],
  classification: "partial", confidence: 0.8, reasoningGap: "Needs consequence",
  misconceptionKey: null,
  strategy: "probe", feedback: "Relevant finding identified", nextQuestion: "Why does that finding matter?",
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: ["Link findings to consequences"], masteryDelta: 0.2 },
};

describe("Claude tutor adapter", () => {
  beforeEach(() => parseMock.mockReset());
  it("uses only the remaining shared request budget", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: parsedOutput });
    await new ClaudeTutor("test-key", "test-model").evaluate({ phase: impactedCanineCase.phases[0], answer: "A learner answer", state, attempt: 1, timeoutMs: 4_500 });
    expect(parseMock.mock.calls[0][1]).toEqual({ timeout: 4_500, maxRetries: 0 });
  });
  it("returns a complete structured evaluation", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: parsedOutput });
    const tutor = new ClaudeTutor("test-key", "test-model");
    await expect(tutor.evaluate({ phase: impactedCanineCase.phases[0], answer: "The canine is unerupted.", state, attempt: 1 })).resolves.toMatchObject({ classification: "partial", source: "claude" });
    expect(parseMock).toHaveBeenCalledOnce();
    expect(parseMock.mock.calls[0][1]).toEqual({ timeout: 25_000, maxRetries: 0 });
  });

  it.each([
    ["missing", null],
    ["invalid", "Can you explain why?"],
  ])("repairs a %s acknowledgement once without accepting a retry regrade", async (_label, acknowledgement) => {
    parseMock
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { ...parsedOutput, acknowledgement, classification: "partial", nextQuestion: "Why does that finding matter?" } })
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: {
        ...parsedOutput,
        acknowledgement: "You linked the finding to the timing.",
        classification: "correct",
        nextQuestion: "A retry question must not be trusted?",
      } });

    const result = await new ClaudeTutor("test-key", "test-model").evaluate({
      phase: impactedCanineCase.phases[0], answer: "The canine is unerupted.", state, attempt: 1, timeoutMs: 10_000,
    });

    expect(parseMock).toHaveBeenCalledTimes(2);
    expect(parseMock.mock.calls[1][0].system).toContain("repair only the acknowledgement field");
    expect(result).toMatchObject({
      acknowledgement: "You linked the finding to the timing.",
      classification: "partial",
      nextQuestion: "Why does that finding matter?",
    });
  });

  it("keeps the first valid grading when acknowledgement repair fails", async () => {
    parseMock
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { ...parsedOutput, acknowledgement: null } })
      .mockRejectedValueOnce(new Error("repair timed out"));

    const result = await new ClaudeTutor("test-key", "test-model").evaluate({
      phase: impactedCanineCase.phases[0], answer: "The canine is unerupted.", state, attempt: 1, timeoutMs: 10_000,
    });

    expect(parseMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ classification: "partial", nextQuestion: parsedOutput.nextQuestion });
    expect(result.acknowledgement).toBeUndefined();
  });

  it("falls back to the question when the repair is still missing", async () => {
    parseMock
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { ...parsedOutput, acknowledgement: null } })
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { ...parsedOutput, acknowledgement: null } });

    const result = await new ClaudeTutor("test-key", "test-model").evaluate({
      phase: impactedCanineCase.phases[0], answer: "The canine is unerupted.", state, attempt: 1, timeoutMs: 10_000,
    });

    expect(parseMock).toHaveBeenCalledTimes(2);
    expect(result.acknowledgement).toBeUndefined();
    expect(result.nextQuestion).toBe(parsedOutput.nextQuestion);
  });

  it("skips repair when the remaining budget is exhausted", async () => {
    parseMock.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { ...parsedOutput, acknowledgement: null } });

    const result = await new ClaudeTutor("test-key", "test-model").evaluate({
      phase: impactedCanineCase.phases[0], answer: "The canine is unerupted.", state, attempt: 1, timeoutMs: 500,
    });

    expect(parseMock).toHaveBeenCalledOnce();
    expect(parseMock.mock.calls[0][1]).toEqual({ timeout: 500, maxRetries: 0 });
    expect(result.acknowledgement).toBeUndefined();
  });

  it("gives the repair call only the time left in the shared budget", async () => {
    const now = vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(7_000);
    parseMock
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { ...parsedOutput, acknowledgement: null } })
      .mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { ...parsedOutput, acknowledgement: "You identified the finding." } });

    try {
      await new ClaudeTutor("test-key", "test-model").evaluate({
        phase: impactedCanineCase.phases[0], answer: "The canine is unerupted.", state, attempt: 1, timeoutMs: 10_000,
      });
      expect(parseMock.mock.calls[1][1]).toEqual({ timeout: 4_000, maxRetries: 0 });
    } finally {
      now.mockRestore();
    }
  });

  it("rejects incomplete stop reasons so the caller can fall back", async () => {
    parseMock.mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    const tutor = new ClaudeTutor("test-key", "test-model");
    await expect(tutor.evaluate({ phase: impactedCanineCase.phases[0], answer: "An answer", state, attempt: 1 })).rejects.toThrow("unusable stop reason");
  });
});
