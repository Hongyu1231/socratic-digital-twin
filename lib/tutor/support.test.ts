import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const parseMock = vi.hoisted(() => vi.fn());
const claudeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tutor/openai-client", () => ({ createOpenAIClient: () => ({ responses: { parse: parseMock } }) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse: claudeMock }; } }));

import { impactedCanineCase } from "@/lib/seed";
import { generateTutorSupport, validateTutorSupportOutput, type TutorSupportInput } from "@/lib/tutor/support";

const input: TutorSupportInput = {
  phase: { ...impactedCanineCase.phases[0], goal: "Form an initial record-based assessment." },
  state: {
    sessionId: crypto.randomUUID(), currentGoal: "goal", previousErrors: [], strengths: [], weaknesses: [],
    nextStrategy: "probe", phaseAttempts: { "1": 1 }, mastery: { "1": 0 }, version: 1, updatedAt: new Date().toISOString(),
  },
  support: { level: 1, targetCriterion: { id: "p1-localisation", text: "Explain provisional localisation", revealText: "An OPG alone cannot establish the buccal or palatal position." } },
  timeoutMs: 7_000,
};
const valid = {
  targetCriterionId: "p1-localisation", supportLevel: 1,
  content: "Imagine choosing treatment from the OPG alone. What would you question about that plan?",
};

describe("ungraded support generation", () => {
  beforeEach(() => { vi.stubEnv("TUTOR_PROVIDER", "openai"); vi.stubEnv("OPENAI_API_KEY", "test-key"); vi.stubEnv("OPENAI_MODEL", "test-model"); parseMock.mockReset(); claudeMock.mockReset(); });
  afterEach(() => vi.unstubAllEnvs());
  it("uses a dedicated support schema, no fabricated answer evaluation", async () => {
    parseMock.mockResolvedValue({ status: "completed", output_parsed: valid });
    expect(await generateTutorSupport(input)).toEqual({ content: valid.content, source: "openai" });
    const [request, options] = parseMock.mock.calls[0];
    expect(options).toEqual({ timeout: 7_000, maxRetries: 0 });
    expect(request.store).toBe(false);
    expect(request.text.format.name).toBe("tutor_support");
    expect(Object.keys(request.text.format.schema.properties)).toEqual(["targetCriterionId", "supportLevel", "content"]);
    expect(request.instructions).toContain("Do not classify or score");
    expect(JSON.parse(request.input).studentAnswer).toBeNull();
  });
  it("does not call any provider in deterministic mode", async () => {
    vi.stubEnv("TUTOR_PROVIDER", "deterministic");
    expect(await generateTutorSupport(input)).toBeNull();
    expect(parseMock).not.toHaveBeenCalled();
  });
  it("returns unavailable on request failure without a fake grade", async () => {
    parseMock.mockRejectedValue(new Error("network failure"));
    expect(await generateTutorSupport(input)).toBeNull();
  });
  it("rejects incomplete provider output", async () => {
    parseMock.mockResolvedValue({ status: "incomplete", output_parsed: valid });
    expect(await generateTutorSupport(input)).toBeNull();
  });
  it("keeps missing configuration as an explicit failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(generateTutorSupport(input)).rejects.toThrow("requires OPENAI_API_KEY");
  });
  it("also supports ungraded Claude generation with the same deadline", async () => {
    vi.stubEnv("TUTOR_PROVIDER", "claude"); vi.stubEnv("ANTHROPIC_API_KEY", "test-key"); vi.stubEnv("CLAUDE_MODEL", "test-model");
    claudeMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: valid });
    expect(await generateTutorSupport(input)).toMatchObject({ source: "claude", content: valid.content });
    expect(claudeMock.mock.calls[0][1]).toEqual({ timeout: 7_000, maxRetries: 0 });
  });
  it.each([
    { ...valid, targetCriterionId: "unknown" },
    { ...valid, supportLevel: 2 },
    { ...valid, content: "What matters? Why?" },
    { ...valid, content: "Review point: what would you check?" },
    { ...valid, content: "Which rubric criterion is missing?" },
    { ...valid, content: "Form an initial record-based assessment. What would you check?" },
    { ...valid, content: "Use p1-localisation. What would you check?" },
    { ...valid, content: "Treat the opening record as a draft. How would you phrase that summary?" },
    { ...valid, classification: "partial" },
  ])("rejects malformed or leaked support output %#", (output) => {
    expect(validateTutorSupportOutput(output, input)).toBeNull();
  });
  it("rejects a repeated earlier tutor question", () => {
    expect(validateTutorSupportOutput(valid, { ...input, recentDialogue: [{ sender: "ai", content: "What would you question about that plan?" }] })).toBeNull();
  });
  it("allows a plain authorized reveal with one application question", () => {
    expect(validateTutorSupportOutput({ targetCriterionId: valid.targetCriterionId, supportLevel: 2,
      content: "An OPG alone cannot establish buccal or palatal position. How would you check that position?" },
    { ...input, support: { ...input.support, level: 2 } })).toContain("How would you check");
  });
});
