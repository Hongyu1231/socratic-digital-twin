import { describe, expect, it } from "vitest";
import type { LearnerState } from "@/lib/domain";
import { mergeLearnerEvidence, reconcileLearnerStateEvidence, removeSummaryContradictions } from "@/lib/tutor/learner-model";
import { buildSessionSummary } from "@/lib/tutor/summary";

const state: LearnerState = {
  sessionId: crypto.randomUUID(),
  currentGoal: "Compare management",
  previousErrors: [],
  strengths: ["Compared permanent-canine extraction with orthodontic retention"],
  weaknesses: [],
  nextStrategy: "probe",
  phaseAttempts: {},
  mastery: {},
  version: 1,
  updatedAt: new Date().toISOString(),
};

describe("learner evidence reconciliation", () => {
  it("does not keep a concept as both a strength and a new weakness", () => {
    const merged = mergeLearnerEvidence(state, {
      addErrors: [],
      addStrengths: [],
      addWeaknesses: ["Needs to compare permanent-canine extraction with orthodontic retention"],
      masteryDelta: 0,
    }, "partial");
    expect(merged.strengths).toEqual([]);
    expect(merged.weaknesses).toHaveLength(1);
  });

  it("filters contradictions from generated summaries", () => {
    const result = removeSummaryContradictions(
      ["Compared permanent-canine extraction with orthodontic retention"],
      ["Needs to compare permanent-canine extraction with orthodontic retention", "Clarify CBCT justification"],
    );
    expect(result.weaknesses).toEqual(["Clarify CBCT justification"]);
  });

  it("closes a phase's historical gap even when the new strength is paraphrased", () => {
    const initial = { ...state, strengths: [], weaknesses: [], phaseEvidence: {} };
    const gap = "Has not yet linked possible CBCT findings to a change in management.";
    const first = mergeLearnerEvidence(initial, {
      addStrengths: ["Identifies canine crown and apex relationships to adjacent roots as relevant CBCT information."],
      addWeaknesses: [gap], addErrors: [], masteryDelta: 0.1,
    }, "partial", { phaseOrder: 2, phaseComplete: false });
    expect(first.weaknesses).toEqual([`Phase 2: ${gap}`]);
    const second = mergeLearnerEvidence({ ...initial, ...first }, {
      addStrengths: ["Links possible canine position and adjacent-root findings to changes in surgical access, traction vector, periodontal risk, prognosis, and extraction discussion."],
      addWeaknesses: [], addErrors: [], masteryDelta: 0.3,
    }, "correct", { phaseOrder: 2, phaseComplete: true });
    expect(second.weaknesses).toEqual([]);
    expect(second.phaseEvidence?.["2"].completed).toBe(true);
    const reloaded = reconcileLearnerStateEvidence(JSON.parse(JSON.stringify({ ...initial, ...second })));
    expect(reloaded.weaknesses).toEqual([]);
    expect(buildSessionSummary([], reloaded, false).weaknesses).toEqual([]);
  });

  it("preserves unrelated open phase gaps and legacy evidence", () => {
    const initial = { ...state, strengths: [], weaknesses: ["Unscoped historical uncertainty"] };
    const first = mergeLearnerEvidence(initial, {
      addErrors: ["Unsupported root safety claim"], addStrengths: [],
      addWeaknesses: ["Connect findings to management"], masteryDelta: 0,
    }, "wrong", { phaseOrder: 1, phaseComplete: false });
    const second = mergeLearnerEvidence({ ...initial, ...first }, {
      addStrengths: ["Connects findings to management"], addWeaknesses: [], addErrors: [], masteryDelta: 0.3,
    }, "correct", { phaseOrder: 2, phaseComplete: true });
    expect(second.weaknesses).toContain("Phase 1: Connect findings to management");
    expect(second.weaknesses).toContain("Unscoped historical uncertainty");
    expect(second.previousErrors).toContain("Phase 1: Unsupported root safety claim");
    expect(removeSummaryContradictions(second.strengths, second.weaknesses).weaknesses).toEqual(second.weaknesses);
  });

  it("does not close a phase while a scripted move blocks advancement", () => {
    const initial = { ...state, strengths: [], weaknesses: [], phaseEvidence: {} };
    const first = mergeLearnerEvidence(initial, {
      addStrengths: [], addWeaknesses: ["Explain the adjacent root risk"], addErrors: [], masteryDelta: 0,
    }, "partial", { phaseOrder: 2, phaseComplete: false });
    const second = mergeLearnerEvidence({ ...initial, ...first }, {
      addStrengths: ["Identifies canine position"], addWeaknesses: [], addErrors: [], masteryDelta: 0.2,
    }, "correct", { phaseOrder: 2, phaseComplete: false });
    expect(second.weaknesses).toContain("Phase 2: Explain the adjacent root risk");
    expect(second.phaseEvidence?.["2"].completed).toBe(false);
  });

  it("does not accept phaseComplete as resolution for a partial answer", () => {
    const result = mergeLearnerEvidence({ ...state, phaseEvidence: {} }, {
      addStrengths: [], addWeaknesses: ["Explain the supporting evidence"], addErrors: [], masteryDelta: 0,
    }, "partial", { phaseOrder: 1, phaseComplete: true });
    expect(result.weaknesses).toEqual(["Phase 1: Explain the supporting evidence"]);
    expect(result.phaseEvidence?.["1"].completed).toBe(false);
  });

  it("does not clear an overlapping gap while scripted progression remains blocked", () => {
    const initial = { ...state, strengths: [], phaseEvidence: {} };
    const first = mergeLearnerEvidence(initial, {
      addStrengths: [], addWeaknesses: ["Needs to compare permanent-canine extraction with orthodontic retention"],
      addErrors: ["Needs to compare permanent-canine extraction with orthodontic retention"], masteryDelta: 0,
    }, "partial", { phaseOrder: 4, phaseComplete: false });
    const second = mergeLearnerEvidence({ ...initial, ...first }, {
      addStrengths: ["Compared permanent-canine extraction with orthodontic retention"],
      addWeaknesses: [], addErrors: [], masteryDelta: 0.2,
    }, "correct", { phaseOrder: 4, phaseComplete: false });
    expect(second.weaknesses).toEqual(first.weaknesses);
    expect(second.previousErrors).toEqual(first.previousErrors);
    expect(second.strengths).toEqual([]);
  });

  it.each<NonNullable<LearnerState["phaseEvidence"]>>([{}, { "2": { strengths: ["Relevant observation"], weaknesses: [], previousErrors: [], completed: true } }])(
    "preserves unrepresented legacy evidence with empty or partial provenance %j", (phaseEvidence) => {
      const legacy = { ...state, phaseEvidence, weaknesses: ["Unscoped gap"], previousErrors: ["Unscoped error"] };
      const reconciled = reconcileLearnerStateEvidence(legacy);
      expect(reconciled.strengths).toContain(state.strengths[0]);
      expect(reconciled.weaknesses).toContain("Unscoped gap");
      expect(reconciled.previousErrors).toContain("Unscoped error");
      expect(reconcileLearnerStateEvidence(reconciled)).toEqual(reconciled);
    },
  );

  it("migrates explicitly phase-owned legacy evidence without resurrecting completed gaps", () => {
    const legacy = {
      ...state,
      strengths: ["Phase 1: Integrates the relevant findings"],
      weaknesses: ["Phase 1: Needs to connect findings to management"],
      previousErrors: ["Phase 1: Unsupported management claim"],
      phaseEvidence: {},
    };
    const reconciled = reconcileLearnerStateEvidence(legacy);

    expect(reconciled.phaseEvidence?.["1"]).toMatchObject({
      strengths: ["Integrates the relevant findings"],
      weaknesses: ["Needs to connect findings to management"],
      previousErrors: ["Unsupported management claim"],
      completed: false,
    });

    const migratedPhase = reconciled.phaseEvidence?.["1"];
    if (!migratedPhase) throw new Error("Expected phase-owned evidence to migrate");
    const completed = reconcileLearnerStateEvidence({
      ...reconciled,
      phaseEvidence: {
        ...reconciled.phaseEvidence,
        "1": { ...migratedPhase, completed: true },
      },
    });
    expect(completed.weaknesses).toEqual([]);
    expect(completed.previousErrors).toEqual([]);
    expect(reconcileLearnerStateEvidence(JSON.parse(JSON.stringify(completed))).weaknesses).toEqual([]);
  });

  it("does not let unscoped legacy strengths erase newer phase-scoped gaps", () => {
    const result = removeSummaryContradictions(
      ["Explains the adjacent root risk"],
      ["Phase 2: Needs to explain the adjacent root risk"],
    );
    expect(result.weaknesses).toEqual(["Phase 2: Needs to explain the adjacent root risk"]);
  });
});
