import { describe, expect, it } from "vitest";

import type { ClinicalCase, SessionBundle } from "@/lib/domain";
import { studentCaseView, studentView } from "@/lib/http";

const PRIVATE_ID = "33333333-3333-4333-8333-333333333333";

function bundleWithPrivateAttachment(): SessionBundle {
  const clinicalCase: ClinicalCase = {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Private media case",
    description: "Synthetic case for response-contract tests.",
    difficulty: "foundation",
    status: "available",
    learningObjectives: ["Read the supplied record"],
    phases: [{
      id: "55555555-5555-4555-8555-555555555555",
      caseId: "44444444-4444-4444-8444-444444444444",
      order: 1,
      title: "Observe",
      goal: "Describe the record.",
      rubric: [{ id: "record", text: "Names the relevant record" }],
      starterQuestion: "What do you observe?",
      exampleQuestions: ["What else is visible?"],
    }],
    attachments: [{
      id: PRIVATE_ID,
      kind: "image",
      title: "Private OPG",
      description: "A de-identified teaching image.",
      storagePath: "cases/44444444/opg.webp",
      sourceLabel: "Private teaching package",
      sourceUrl: "https://private.example.invalid/source",
      posterUrl: "https://private.example.invalid/poster.webp",
      url: "https://private.example.invalid/raw.webp",
    }],
    findings: [],
  };
  return {
    case: clinicalCase,
    session: {
      id: "66666666-6666-4666-8666-666666666666",
      studentId: "77777777-7777-4777-8777-777777777777",
      caseId: clinicalCase.id,
      currentPhase: 1,
      status: "active",
      reviewStatus: "pending",
      score: null,
      summary: {
        overallScore: 0,
        headline: "In progress",
        narrative: "Keep reasoning from the record.",
        strengths: [],
        weaknesses: [],
        nextSteps: [],
        completedAllPhases: false,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      messages: [],
      evaluations: [{
        id: "88888888-8888-4888-8888-888888888888",
        messageId: "99999999-9999-4999-8999-999999999999",
        classification: "correct",
        confidence: 1,
        reasoningGap: "internal",
        strategy: "probe",
        phaseComplete: false,
        feedback: "internal",
        criteriaMet: [{ id: "record", evidence: "internal evidence" }],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
      state: {
        sessionId: "66666666-6666-4666-8666-666666666666",
        currentGoal: "Describe the record.",
        previousErrors: ["internal error"],
        strengths: ["internal strength"],
        weaknesses: ["internal weakness"],
        nextStrategy: "probe",
        phaseAttempts: { "1": 1 },
        mastery: { record: 1 },
        phaseEvidence: { "1": { strengths: [], weaknesses: [], previousErrors: [], completed: false } },
        phaseProgress: { "1": { criteriaMet: ["record"], bestClassification: "correct", noProgressCount: 0, supportLevel: 0, awaitingApplication: false, completedWithSupport: false, completed: false } },
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    student: { id: "77777777-7777-4777-8777-777777777777", name: "Student", email: "private@example.invalid", role: "student" },
    answerReviews: [],
    tutorTurnReviews: [],
    sessionReview: null,
    runtime: { storage: "memory", tutor: "deterministic" },
    summaryGenerationStatus: "ready",
  };
}

describe("student response contract regressions", () => {
  it("never serializes private media references or internal grading state", () => {
    const bundle = bundleWithPrivateAttachment();
    const view = studentView(bundle);
    const attachment = view.case.attachments[0];

    expect(attachment).toEqual(expect.objectContaining({ id: PRIVATE_ID, title: "Private OPG" }));
    expect(attachment).not.toHaveProperty("storagePath");
    expect(attachment).not.toHaveProperty("url");
    expect(attachment).not.toHaveProperty("posterUrl");
    expect(attachment).not.toHaveProperty("sourceUrl");
    expect(JSON.stringify(view)).not.toContain("private.example.invalid");
    expect(JSON.stringify(view)).not.toContain("internal evidence");
    expect(JSON.stringify(view)).not.toContain("internal error");
    expect(view.session).not.toHaveProperty("evaluations");
    expect(view.session).not.toHaveProperty("state");
    expect(view.case.phases[0].phaseProgress).toEqual({ criteriaMet: 1, criteriaTotal: 1, completedWithSupport: false });
  });

  it("keeps catalogue responses media-free and preserves optional summary provenance", () => {
    const bundle = bundleWithPrivateAttachment();
    const catalogue = studentCaseView(bundle.case);
    expect(catalogue.attachments).toEqual([]);
    expect(catalogue.findings).toEqual([]);

    bundle.session.summary = { ...bundle.session.summary!, supportedPhases: [1] };
    const view = studentView(bundle);
    expect(view.session.summary?.supportedPhases).toEqual([1]);
  });
});
