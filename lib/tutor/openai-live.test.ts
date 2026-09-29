import { describe, expect, it } from "vitest";

import type { LearnerState } from "@/lib/domain";
import { impactedCanineCase } from "@/lib/seed";
import { OpenAITutor } from "@/lib/tutor/openai";

const requested = process.env.RUN_OPENAI_LIVE_TESTS === "true";

function redactError(error: unknown): string {
  if (!(error instanceof Error)) return "non-error rejection";
  const record = error as Error & { status?: unknown; code?: unknown; type?: unknown; request_id?: unknown };
  const fields = [
    `name=${record.name}`,
    `message=${record.message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")}`,
  ];
  for (const key of ["status", "code", "type", "request_id"] as const) {
    const value = record[key];
    if (value !== undefined && key !== "request_id") fields.push(`${key}=${String(value)}`);
    if (key === "request_id" && value !== undefined) fields.push("request_id=[present]");
  }
  if (record.cause instanceof Error) {
    fields.push(`causeName=${record.cause.name}`);
    fields.push(`causeMessage=${record.cause.message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")}`);
  }
  return fields.join(" ");
}

const liveDescribe = requested ? describe : describe.skip;

liveDescribe("opt-in OpenAI tutor smoke test", () => {
  it("returns structured output for a synthetic canine answer", async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;
    if (!apiKey || !model) throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required.");

    const phase = impactedCanineCase.phases[0];
    const state: LearnerState = {
      sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      currentGoal: phase.goal,
      previousErrors: [],
      strengths: [],
      weaknesses: [],
      nextStrategy: "probe",
      phaseAttempts: { [String(phase.order)]: 0 },
      mastery: { [String(phase.order)]: 0 },
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    try {
      const result = await new OpenAITutor(apiKey, model).evaluate({
        phase,
        answer: "The upper canine has not erupted and the retained primary canine is an important visible finding.",
        state,
        attempt: 1,
        currentQuestion: phase.starterQuestion,
      });
      expect(result.source).toBe("openai");
      expect(result.nextQuestion.length).toBeGreaterThan(0);
    } catch (error) {
      throw new Error(`OpenAI live smoke failed: ${redactError(error)}`);
    }
  }, 40_000);
});
