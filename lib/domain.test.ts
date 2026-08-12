import { describe, expect, it } from "vitest";
import { calculateScore, type Evaluation } from "@/lib/domain";

const evaluation = (classification: Evaluation["classification"]): Evaluation => ({
  id: crypto.randomUUID(), messageId: crypto.randomUUID(), classification,
  confidence: 0.8, reasoningGap: "gap", strategy: "probe", phaseComplete: false,
  feedback: "feedback", createdAt: new Date().toISOString(),
});

describe("reasoning score", () => {
  it("uses the agreed four-level scoring scale", () => {
    expect(calculateScore([evaluation("correct"), evaluation("partial"), evaluation("vague"), evaluation("wrong")])).toBe(53);
  });
  it("returns zero without evidence", () => expect(calculateScore([])).toBe(0));
});
