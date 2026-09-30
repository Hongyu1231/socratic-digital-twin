import { describe, expect, it } from "vitest";
import type { LearnerState } from "@/lib/domain";
import { buildSessionSummary } from "@/lib/tutor/summary";

const learnerState = (overrides: Partial<LearnerState> = {}): LearnerState => ({
  sessionId: "00000000-0000-4000-8000-000000000001",
  currentGoal: "Reason from the supplied evidence.",
  previousErrors: [],
  strengths: [],
  weaknesses: [],
  nextStrategy: "reflect",
  phaseAttempts: {},
  mastery: {},
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("buildSessionSummary", () => {
  it("uses case-agnostic completion wording for a one-phase session", () => {
    const summary = buildSessionSummary([], learnerState({
      phaseProgress: {
        "1": {
          criteriaMet: [],
          bestClassification: "partial",
          noProgressCount: 0,
          supportLevel: 2,
          awaitingApplication: false,
          completedWithSupport: true,
          completed: true,
        },
      },
    }), true);

    expect(summary.narrative).toContain("You completed the assigned teaching phases and reflection.");
    expect(summary.narrative).not.toContain("identification, assessment, risk, management");
    expect(summary.narrative).toContain("Phase 1 was completed with tutor support, not demonstrated independent mastery.");
  });

  it("keeps the formative caveat when a session ends before completion", () => {
    const summary = buildSessionSummary([], learnerState(), false);

    expect(summary.narrative).toContain("You ended the session before all assigned phases were completed.");
  });
});
