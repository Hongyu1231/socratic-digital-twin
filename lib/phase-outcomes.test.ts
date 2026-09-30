import { describe, expect, it } from "vitest";
import { phaseCompletionLabel } from "@/lib/phase-outcomes";
import type { SessionSummary } from "@/lib/domain";

const phase = { id: "p", order: 1, title: "Observe", goal: "Describe the record." };
const summary: SessionSummary = { overallScore: 70, headline: "Summary", narrative: "Summary", strengths: ["Engaged"], weaknesses: [], nextSteps: ["Review"], completedAllPhases: true };

describe("phase outcome presentation", () => {
  it("retains historical support flags even without phase progress", () => {
    expect(phaseCompletionLabel(phase, 1, { ...summary, supportedPhases: [1] })).toBe("Completed with tutor support");
    expect(phaseCompletionLabel(phase, 1, summary)).toBe("Completed — support not recorded");
  });
  it("only claims independent completion when all criteria are evidenced", () => {
    const evidenced = { ...phase, phaseProgress: { criteriaMet: 1, criteriaTotal: 1, completedWithSupport: false } };
    expect(phaseCompletionLabel(evidenced, 1, summary)).toBe("Completed independently");
    expect(phaseCompletionLabel(evidenced, 1, { ...summary, supportedPhases: [1] })).toBe("Completed with tutor support");
  });
  it("does not mark a manually ended current phase completed", () => {
    expect(phaseCompletionLabel(phase, 1, { ...summary, completedAllPhases: false })).toBe("Not completed");
  });
  it("retains a completed supported phase when the learner ends before reflection", () => {
    expect(phaseCompletionLabel(phase, 1, { ...summary, completedAllPhases: false, supportedPhases: [1] })).toBe("Completed with tutor support");
  });
});
