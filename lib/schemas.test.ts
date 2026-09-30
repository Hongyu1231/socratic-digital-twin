import { describe, expect, it } from "vitest";

import { assignmentInputSchema, caseAttachmentInputSchema, caseInputSchema, summaryOutputSchema } from "@/lib/schemas";

describe("assignment input schema", () => {
  const validAssignment = {
    classId: "55555555-5555-4555-8555-555555555555",
    caseId: "33333333-3333-4333-8333-333333333333",
    opensAt: "2026-08-09T00:00:00.000+00:00",
    dueAt: null,
  };

  it("accepts absent or persisted-null idempotency keys", () => {
    expect(assignmentInputSchema.safeParse(validAssignment).success).toBe(true);
    expect(assignmentInputSchema.safeParse({ ...validAssignment, idempotencyKey: null }).success).toBe(true);
    expect(assignmentInputSchema.safeParse({ ...validAssignment, idempotencyKey: "assignment:one" }).success).toBe(true);
  });

  it("rejects empty and whitespace-only idempotency keys", () => {
    expect(assignmentInputSchema.safeParse({ ...validAssignment, idempotencyKey: "" }).success).toBe(false);
    expect(assignmentInputSchema.safeParse({ ...validAssignment, idempotencyKey: "   " }).success).toBe(false);
  });
});

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
    expect(caseAttachmentInputSchema.safeParse({
      ...opg,
      url: "/media/cases/opg.jpg",
      sourceLabel: undefined,
      sourceUrl: undefined,
    }).success).toBe(true);
  });

  it("rejects missing image URLs and unsafe URL schemes", () => {
    expect(caseAttachmentInputSchema.safeParse({ ...opg, url: undefined }).success).toBe(false);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, url: "javascript:alert(1)" }).success).toBe(false);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, url: "http://example.org/opg.jpg" }).success).toBe(false);
  });

  it("requires a complete citation for externally hosted literature media", () => {
    expect(caseAttachmentInputSchema.safeParse({ ...opg, sourceLabel: undefined }).success).toBe(false);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, sourceUrl: undefined }).success).toBe(false);
  });

  it("allows descriptive media text beyond the legacy 500-character bound up to 2000", () => {
    expect(caseAttachmentInputSchema.safeParse({ ...opg, description: "d".repeat(501) }).success).toBe(true);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, description: "d".repeat(2_000) }).success).toBe(true);
    expect(caseAttachmentInputSchema.safeParse({ ...opg, description: "d".repeat(2_001) }).success).toBe(false);
  });

  it("uses the same 2000-character description contract for cases", () => {
    const baseCase = {
      title: "Schema test case",
      difficulty: "intermediate" as const,
      learningObjectives: ["Use the supplied evidence."],
      attachments: [],
      findings: [],
      phases: [{
        order: 1,
        title: "Observe",
        goal: "Describe a finding.",
        rubric: ["Name the finding."],
        starterQuestion: "What do you observe?",
        exampleQuestions: ["Which record supports that observation?"],
        tutorGuidance: [],
        tutorMoves: [],
      }],
    };
    expect(caseInputSchema.safeParse({ ...baseCase, description: "d".repeat(501) }).success).toBe(true);
    expect(caseInputSchema.safeParse({ ...baseCase, description: "d".repeat(2_000) }).success).toBe(true);
    expect(caseInputSchema.safeParse({ ...baseCase, description: "d".repeat(2_001) }).success).toBe(false);
  });
});
