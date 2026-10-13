import { describe, expect, it, vi } from "vitest";
import type { TutorEvaluationResult } from "@/lib/domain";
import {
  normalizeAcknowledgement,
  retryAcknowledgement,
  stepUpAcknowledgement,
  SUPPORTED_PHASE_ACKNOWLEDGEMENT,
  supportedPhaseAcknowledgement,
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

  it("keeps a valid model acknowledgement for a supported phase", () => {
    expect(supportedPhaseAcknowledgement("  You linked the film to the tooth position.  ")).toBe("You linked the film to the tooth position.");
    expect(supportedPhaseAcknowledgement("You corrected the crowding to moderate.")).toBe("You corrected the crowding to moderate.");
    expect(supportedPhaseAcknowledgement("You named the greatest uncertainty.")).toBe("You named the greatest uncertainty.");
  });

  it.each([
    undefined, null, "", "Does that help?", "x".repeat(201),
    `${Array.from({ length: 21 }, () => "word").join(" ")}.`,
    "You've got it.", "You\u2019ve got it now.", "You have got it.", "You got this.", "You have mastered the localisation.",
    "Well done on the localisation.", "Great point about the film.", "That's right about the film.", "You correctly named the tooth.",
    "You now understand the limit of the OPG.", "Exactly right about the canine.",
  ])("falls back to the exact fixed line for %s", (value) => {
    expect(SUPPORTED_PHASE_ACKNOWLEDGEMENT).toBe("Let's move on to the next part.");
    expect(supportedPhaseAcknowledgement(value)).toBe("Let's move on to the next part.");
  });

  it("allows at most 20 words before a step-up", () => {
    const words = (count: number) => `${Array.from({ length: count }, () => "word").join(" ")}.`;
    expect(stepUpAcknowledgement(words(20))).toBe(words(20));
    expect(stepUpAcknowledgement(words(21))).toBeUndefined();
    expect(stepUpAcknowledgement("Is that so?")).toBeUndefined();
    expect(stepUpAcknowledgement(undefined)).toBeUndefined();
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
