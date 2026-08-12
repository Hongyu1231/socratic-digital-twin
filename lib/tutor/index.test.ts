import { afterEach, describe, expect, it, vi } from "vitest";
import { impactedCanineCase } from "@/lib/seed";
import type { LearnerState, TutorEvaluationResult } from "@/lib/domain";

const deterministicResult: TutorEvaluationResult = {
  classification: "partial",
  confidence: 0.74,
  reasoningGap: "Needs another evidence link.",
  strategy: "probe",
  feedback: "Useful starting point.",
  nextQuestion: "What additional evidence supports that conclusion?",
  memoryPatch: {
    addErrors: [],
    addStrengths: [],
    addWeaknesses: ["Needs another evidence link."],
    masteryDelta: 0.2,
  },
  source: "deterministic",
};

const state: LearnerState = {
  sessionId: crypto.randomUUID(),
  currentGoal: "goal",
  previousErrors: [],
  strengths: [],
  weaknesses: [],
  nextStrategy: "probe",
  phaseAttempts: {},
  mastery: {},
  version: 1,
  updatedAt: new Date().toISOString(),
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("tutor provider fallback", () => {
  it.each([
    Object.assign(new Error("request timed out"), { name: "APIConnectionTimeoutError" }),
    Object.assign(new Error("rate limited"), { name: "RateLimitError", status: 429, _request_id: "req_rate" }),
    Object.assign(new Error("service unavailable"), { name: "InternalServerError", status: 503 }),
  ])("falls back to the deterministic engine after %s", async (providerError) => {
    const deterministicEvaluate = vi.fn().mockResolvedValue(deterministicResult);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "test-model");
    vi.doMock("@/lib/tutor/openai", () => ({
      OpenAITutor: class {
        readonly mode = "openai";
        evaluate = vi.fn().mockRejectedValue(providerError);
      },
    }));
    vi.doMock("@/lib/tutor/deterministic", () => ({
      DeterministicTutor: class {
        readonly mode = "deterministic";
        evaluate = deterministicEvaluate;
      },
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { evaluateWithFallback } = await import("@/lib/tutor/index");
    const result = await evaluateWithFallback({
      phase: impactedCanineCase.phases[0],
      answer: "A sufficiently detailed answer for evaluation.",
      state,
      attempt: 1,
    });

    expect(result).toEqual(deterministicResult);
    expect(deterministicEvaluate).toHaveBeenCalledOnce();
  });
});
