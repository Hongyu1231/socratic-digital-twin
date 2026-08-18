import { describe, expect, it } from "vitest";

import { summaryOutputSchema } from "@/lib/schemas";

describe("summary output schema", () => {
  const validSummary = {
    headline: "Evidence-led reasoning is taking shape",
    narrative: "The learner connected findings to a proportionate next step.",
    strengths: ["Connected the finding to the decision"],
    weaknesses: [],
    nextSteps: ["State the uncertainty the next investigation resolves"],
  };

  it("requires at least one strength", () => {
    expect(summaryOutputSchema.safeParse(validSummary).success).toBe(true);
    expect(summaryOutputSchema.safeParse({ ...validSummary, strengths: [] }).success).toBe(false);
  });
});
