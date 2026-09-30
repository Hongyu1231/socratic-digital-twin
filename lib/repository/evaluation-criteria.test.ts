import { describe, expect, it } from "vitest";
import type { Evaluation } from "@/lib/domain";
import { buildEvaluationCriteria, readCriteriaMet, readMisconceptionKey } from "@/lib/repository/evaluation-criteria";

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

  it("persists structured progress and retrieval metadata explicitly", () => {
    const criteria = buildEvaluationCriteria({
      id: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      classification: "partial",
      confidence: 0.8,
      reasoningGap: "Needs a consequence.",
      strategy: "probe",
      phaseComplete: false,
      feedback: "What changes your plan?",
      targetCriterionId: "consequence",
      criteriaMet: ["finding"],
      supportLevel: 1,
      completedWithSupport: true,
      isReflection: false,
      retrieval: { query: "canine impaction", passages: [{ sourceId: "paper-1", page: 2, locator: "p3", score: 0.91 }] },
      createdAt: new Date().toISOString(),
    });

    expect(criteria).toMatchObject({
      targetCriterionId: "consequence",
      criteriaMet: ["finding"],
      supportLevel: 1,
      completedWithSupport: true,
      isReflection: false,
      retrieval: { query: "canine impaction", passages: [{ sourceId: "paper-1", page: 2, locator: "p3", score: 0.91 }] },
    });
  });

  it("round-trips structured criterion evidence and retains historical strings", () => {
    const structured = [{ id: "finding", evidence: "The student named the unerupted canine." }];
    const criteria = buildEvaluationCriteria({
      id: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      classification: "partial",
      confidence: 0.8,
      reasoningGap: "Needs a consequence.",
      strategy: "probe",
      phaseComplete: false,
      feedback: "Explain why.",
      criteriaMet: structured,
      createdAt: new Date().toISOString(),
    });

    expect(criteria.criteriaMet).toEqual(structured);
    expect(readCriteriaMet(criteria)).toEqual(structured);
    expect(readCriteriaMet({ criteriaMet: ["finding"] })).toEqual(["finding"]);
    expect(readCriteriaMet({ criteriaMet: [{ id: "finding", evidence: "" }, { nope: true }] })).toBeUndefined();
  });

  it("normalizes legacy or malformed criteria to no misconception key", () => {
    expect(readMisconceptionKey({})).toBeNull();
    expect(readMisconceptionKey({ misconceptionKey: "" })).toBeNull();
    expect(readMisconceptionKey({ misconceptionKey: 42 })).toBeNull();
  });
});
