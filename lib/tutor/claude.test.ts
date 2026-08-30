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
  classification: "partial", confidence: 0.8, reasoningGap: "Needs consequence",
  misconceptionKey: null,
  strategy: "probe", feedback: "Relevant finding identified", nextQuestion: "Why does that finding matter?",
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: ["Link findings to consequences"], masteryDelta: 0.2 },
};

describe("Claude tutor adapter", () => {
  beforeEach(() => parseMock.mockReset());
  it("returns a complete structured evaluation", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: parsedOutput });
    const tutor = new ClaudeTutor("test-key", "test-model");
    await expect(tutor.evaluate({ phase: impactedCanineCase.phases[0], answer: "The canine is unerupted.", state, attempt: 1 })).resolves.toMatchObject({ classification: "partial", source: "claude" });
  });
  it("rejects incomplete stop reasons so the caller can fall back", async () => {
    parseMock.mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    const tutor = new ClaudeTutor("test-key", "test-model");
    await expect(tutor.evaluate({ phase: impactedCanineCase.phases[0], answer: "An answer", state, attempt: 1 })).rejects.toThrow("unusable stop reason");
  });
});
