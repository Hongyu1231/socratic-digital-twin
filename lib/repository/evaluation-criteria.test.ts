import { describe, expect, it } from "vitest";
import type { Evaluation } from "@/lib/domain";
import { buildEvaluationCriteria, readMisconceptionKey } from "@/lib/repository/evaluation-criteria";

describe("Supabase evaluation criteria", () => {
  it("round-trips a stable misconception key for the next tutor turn", () => {
    const evaluation: Evaluation = {
      id: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      classification: "wrong",
      confidence: 0.96,
      reasoningGap: "The claim contradicts the root-resorption rubric.",
      misconceptionKey: "root-resorption-claim",
      strategy: "challenge",
      phaseComplete: false,
      feedback: "The absolute claim is not supported.",
      phaseOrder: 3,
      attempt: 1,
      createdAt: new Date().toISOString(),
    };

    const criteria = buildEvaluationCriteria(evaluation);
    expect(criteria.misconceptionKey).toBe("root-resorption-claim");
    expect(readMisconceptionKey(criteria)).toBe("root-resorption-claim");
  });

  it("normalizes legacy or malformed criteria to no misconception key", () => {
    expect(readMisconceptionKey({})).toBeNull();
    expect(readMisconceptionKey({ misconceptionKey: "" })).toBeNull();
    expect(readMisconceptionKey({ misconceptionKey: 42 })).toBeNull();
  });
});
