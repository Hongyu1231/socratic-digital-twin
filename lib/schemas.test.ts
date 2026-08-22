import { describe, expect, it } from "vitest";

import { caseAttachmentInputSchema, summaryOutputSchema } from "@/lib/schemas";

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

describe("case attachment input schema", () => {
  const opg = {
    kind: "image" as const,
    title: "Panoramic radiograph",
    description: "An OPG showing the developing dentition and an unerupted maxillary canine.",
    url: "https://example.org/published-opg.jpg",
    sourceLabel: "Published teaching figure",
    sourceUrl: "https://example.org/article",
  };

  it("accepts cited HTTPS images and site-relative teaching assets", () => {
    expect(caseAttachmentInputSchema.safeParse(opg).success).toBe(true);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, url: "/media/cases/opg.jpg" }).success).toBe(true);
  });

  it("rejects missing image URLs and unsafe URL schemes", () => {
    expect(caseAttachmentInputSchema.safeParse({ ...opg, url: undefined }).success).toBe(false);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, url: "javascript:alert(1)" }).success).toBe(false);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, url: "http://example.org/opg.jpg" }).success).toBe(false);
  });
});
