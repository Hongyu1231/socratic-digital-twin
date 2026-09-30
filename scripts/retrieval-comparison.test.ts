import { afterEach, describe, expect, it } from "vitest";

import {
  buildComparisonQueries,
  runRetrievalComparison,
  runSyntheticRetrievalComparison,
  syntheticComparisonSamples,
  type ComparisonTrace,
} from "./retrieval-comparison";

afterEach(() => {
  delete process.env.TUTOR_MATERIALS_DIR;
  delete process.env.FORCE_MEMORY_REPOSITORY;
  delete process.env.VERCEL;
});

describe("offline retrieval comparison harness", () => {
  it("builds the exact baseline and criterion-focused queries from §3.9", () => {
    const sample = syntheticComparisonSamples()[0]!;
    expect(buildComparisonQueries(sample)).toEqual({
      baseline: `${sample.studentAnswer} ${sample.currentQuestion} ${sample.phaseGoal}`,
      criterion: `${sample.studentAnswer} ${sample.targetCriterionText}`,
    });
  });

  it("compares fixed metadata labels without requiring model or production access", () => {
    const sample = syntheticComparisonSamples()[0]!;
    const calls: string[] = [];
    const traces = new Map<string, ComparisonTrace>([
      ["baseline", { query: "baseline", passages: [] }],
      ["criterion", { query: "criterion", passages: [{ sourceId: "synthetic-root-risk", page: 1, score: 2 }] }],
    ]);
    const report = runRetrievalComparison({
      caseId: "synthetic-case",
      samples: [sample],
      retrieve: (_caseId, query) => {
        calls.push(query);
        return calls.length === 1 ? traces.get("baseline")! : traces.get("criterion")!;
      },
    });

    expect(calls).toHaveLength(2);
    expect(report.metrics).toMatchObject({
      samples: 1,
      baselineHitRateAt4: 0,
      criterionHitRateAt4: 1,
      criterionNotWorseOnSyntheticLabels: true,
    });
    expect(report.samples[0]).toMatchObject({ id: sample.id, verdict: "criterion-better" });
  });

  it("runs against the current retriever with synthetic content and no raw passage text in the report", () => {
    const report = runSyntheticRetrievalComparison();
    expect(report.harness).toBe("retrieval-comparison-v1");
    expect(report.dataset).toBe("synthetic");
    expect(report.runtimePolicyChanged).toBe(false);
    expect(report.decision).toBe("retain-baseline-pending-labelled-evidence");
    expect(report.clinicalConclusion).toBe("not-assessed");
    expect(report.metrics.samples).toBe(3);
    expect(report.metrics.criterionMeanReciprocalRank).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("root resorption risk");
    expect(serialized).not.toContain("Synthetic adjacent-root risk");
    expect(serialized).not.toContain("synthetic-retrieval-fixture.txt");
    for (const sample of report.samples) {
      expect(sample.baseline.passages.every((passage) => Object.keys(passage).every((key) => ["sourceId", "page", "locator", "score"].includes(key)))).toBe(true);
      expect(sample.criterion.passages.every((passage) => Object.keys(passage).every((key) => ["sourceId", "page", "locator", "score"].includes(key)))).toBe(true);
    }
  });

  it("refuses an unlabeled or duplicated fixed answer instead of implying evidence", () => {
    const sample = syntheticComparisonSamples()[0]!;
    expect(() => runRetrievalComparison({
      caseId: "synthetic-case",
      samples: [{ ...sample, expectedPassages: [] }],
      retrieve: () => ({ query: "", passages: [] }),
    })).toThrow(/no expected passage label/i);
    expect(() => runRetrievalComparison({
      caseId: "synthetic-case",
      samples: [sample, { ...sample }],
      retrieve: () => ({ query: "", passages: [] }),
    })).toThrow(/duplicate retrieval comparison sample id/i);
  });
});
