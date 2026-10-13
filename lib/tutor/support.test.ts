import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const parseMock = vi.hoisted(() => vi.fn());
const claudeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tutor/openai-client", () => ({ createOpenAIClient: () => ({ responses: { parse: parseMock } }) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { parse: claudeMock }; } }));

import { impactedCanineCase } from "@/lib/seed";
import { generateTutorSupport, TUTOR_SUPPORT_INSTRUCTIONS, validateTutorSupportOutput, type TutorSupportInput } from "@/lib/tutor/support";

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
    { ...valid, content: "What would you check first? Imagine choosing treatment from the OPG alone." },
    { ...valid, classification: "partial" },
  ])("rejects malformed or leaked support output %#", (output) => {
    expect(validateTutorSupportOutput(output, input)).toBeNull();
  });
  it("rejects a repeated earlier tutor question", () => {
    expect(validateTutorSupportOutput(valid, { ...input, recentDialogue: [{ sender: "ai", content: "What would you question about that plan?" }] })).toBeNull();
  });
  it("rejects an older session question outside recent dialogue", () => {
    expect(validateTutorSupportOutput(valid, {
      ...input,
      askedQuestions: ["What would you question about that plan?"],
      recentDialogue: [],
    })).toBeNull();
  });
  it("rejects a repeated trailing question when earlier entries include support prose", () => {
    const content = "Imagine a different plan. What would you question about that plan?";
    expect(validateTutorSupportOutput({ ...valid, content }, {
      ...input,
      askedQuestions: ["Imagine choosing treatment from the OPG alone. What would you question about that plan?"],
      recentDialogue: [],
    })).toBeNull();
  });
  it("rejects the current question even when askedQuestions is omitted", () => {
    expect(validateTutorSupportOutput(valid, {
      ...input,
      currentQuestion: valid.content,
      askedQuestions: [],
      recentDialogue: [],
    })).toBeNull();
  });
  it("allows a genuinely different support question", () => {
    const content = "Imagine choosing treatment from the OPG alone. Which record would you check next?";
    expect(validateTutorSupportOutput({ ...valid, content }, {
      ...input,
      askedQuestions: ["What would you question about that plan?"],
      recentDialogue: [],
    })).toBe(content);
  });
  const words = (count: number) => `${Array.from({ length: count - 4 }, () => "word").join(" ")}. What would you do?`;
  const level2 = { ...input, support: { ...input.support, level: 2 as const } };
  it("limits a level 1 plan to 40 words and a level 2 reveal to 60 words", () => {
    expect(validateTutorSupportOutput({ ...valid, content: words(40) }, input)).toBe(words(40));
    expect(validateTutorSupportOutput({ ...valid, content: words(41) }, input)).toBeNull();
    expect(validateTutorSupportOutput({ ...valid, supportLevel: 2, content: words(60) }, level2)).toBe(words(60));
    expect(validateTutorSupportOutput({ ...valid, supportLevel: 2, content: words(61) }, level2)).toBeNull();
  });
  it("accepts a level 1 plain question with no critique-type word", () => {
    const content = "One plan is to treat the opening record as final. How would you phrase that summary?";
    expect(validateTutorSupportOutput({ ...valid, content }, input)).toBe(content);
  });
  it("states the limits, the plain-question rule and one generic example", () => {
    expect(TUTOR_SUPPORT_INSTRUCTIONS).toContain("At level 1, write at most 40 words in total");
    expect(TUTOR_SUPPORT_INSTRUCTIONS).toContain("At level 2, write at most 60 words in total");
    expect(TUTOR_SUPPORT_INSTRUCTIONS).toContain("ending in exactly one plain question");
    expect(TUTOR_SUPPORT_INSTRUCTIONS).toContain("One plan is to start treatment from a single X-ray view. What might that plan miss?");
    expect(TUTOR_SUPPORT_INSTRUCTIONS).not.toMatch(/critique|at most 80 words|#\d\d|\u2014/);
  });
  it("sends every question already asked and forbids asking or rewording them", async () => {
    parseMock.mockResolvedValue({ status: "completed", output_parsed: valid });
    const askedQuestions = ["What do you see on the OPG?", "Which tooth is missing from the arch?"];
    await generateTutorSupport({ ...input, askedQuestions });
    expect(JSON.parse(parseMock.mock.calls[0][0].input).askedQuestions).toEqual(askedQuestions);
    expect(TUTOR_SUPPORT_INSTRUCTIONS).toContain("askedQuestions lists every tutor question already asked in this session, across all phases");
    expect(TUTOR_SUPPORT_INSTRUCTIONS).toContain("Never ask any of them again and never reword one of them");
  });
  it("allows a plain authorized reveal with one application question", () => {
    expect(validateTutorSupportOutput({ targetCriterionId: valid.targetCriterionId, supportLevel: 2,
      content: "An OPG alone cannot establish buccal or palatal position. How would you check that position?" },
    { ...input, support: { ...input.support, level: 2 } })).toContain("How would you check");
  });
});
