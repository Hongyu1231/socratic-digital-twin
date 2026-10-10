import { describe, expect, it, vi } from "vitest";
import type { TutorEvaluationResult } from "@/lib/domain";
import {
  normalizeAcknowledgement,
  retryAcknowledgement,
} from "@/lib/tutor/acknowledgement";

const first = {
  classification: "partial",
  confidence: 0.8,
  reasoningGap: "Needs consequence",
  misconceptionKey: null,
  strategy: "probe",
  feedback: "Relevant finding identified",
  nextQuestion: "Why does that finding matter?",
  acknowledgement: undefined,
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: [], masteryDelta: 0 },
  source: "openai",
  criteriaMet: [{ id: "criterion", evidence: "The finding is named." }],
} as TutorEvaluationResult;

describe("acknowledgement repair", () => {
  it("accepts only short non-question wording", () => {
    expect(normalizeAcknowledgement("  You named the finding.  ")).toBe("You named the finding.");
    expect(normalizeAcknowledgement(null)).toBeUndefined();
    expect(normalizeAcknowledgement("Can you explain why?")).toBeUndefined();
    expect(normalizeAcknowledgement("x".repeat(201))).toBeUndefined();
  });

  it("uses only a repaired acknowledgement and keeps the first grading", async () => {
    const repaired = await retryAcknowledgement(first, Date.now() + 5_000, async () => ({
      ...first,
      acknowledgement: "You connected the finding to the timing.",
      classification: "correct",
      nextQuestion: "A changed retry question must not be trusted?",
      criteriaMet: [],
    }));

    expect(repaired).toMatchObject({
      acknowledgement: "You connected the finding to the timing.",
      classification: "partial",
      nextQuestion: first.nextQuestion,
      criteriaMet: first.criteriaMet,
    });
  });

  it("does not call the provider after the shared deadline", async () => {
    const retry = vi.fn();
    const result = await retryAcknowledgement(first, Date.now() - 1, retry);
    expect(retry).not.toHaveBeenCalled();
    expect(result.acknowledgement).toBeUndefined();
    expect(result.classification).toBe(first.classification);
  });
});
