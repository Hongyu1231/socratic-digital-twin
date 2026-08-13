import { describe, expect, it } from "vitest";
import {
  computeHumanizationMetrics,
  type HumanizationMetricRecord,
} from "@/lib/tutor/humanization-metrics";

describe("computeHumanizationMetrics", () => {
  it("returns nulls when there are no records or no usable denominators", () => {
    expect(computeHumanizationMetrics([])).toEqual({
      coverage: null,
      exactAgreement: null,
      balancedAccuracy: null,
      meanAbsoluteError: null,
      signedBias: null,
      brierScore: null,
      falseAdvanceRate: null,
      meanTutorQuality: null,
      humanizationPassRate: null,
    });

    expect(
      computeHumanizationMetrics([
        { aiLabel: "correct", confidence: 0.8, phaseComplete: true },
        { professorLabel: "partial", tutorQuality: {} },
      ]),
    ).toMatchObject({
      coverage: 0.5,
      exactAgreement: null,
      balancedAccuracy: null,
      meanAbsoluteError: null,
      signedBias: null,
      brierScore: null,
      falseAdvanceRate: null,
      meanTutorQuality: null,
      humanizationPassRate: null,
    });
  });

  it("uses professor-labelled turns for calibration and safely ignores missing values", () => {
    const records: HumanizationMetricRecord[] = [
      {
        aiLabel: "correct",
        professorLabel: "correct",
        confidence: 0.9,
        phaseComplete: false,
        tutorQuality: {
          naturalness: 5,
          specificity: 5,
          nonLeading: 5,
          challengeFit: 5,
          helpfulness: 5,
        },
      },
      {
        aiLabel: "partial",
        professorLabel: "correct",
        confidence: 0.4,
        phaseComplete: true,
        tutorQuality: {
          naturalness: 4,
          specificity: 4,
          nonLeading: 3,
          challengeFit: 4,
          helpfulness: 4,
          failureTags: [],
        },
      },
      {
        aiLabel: "wrong",
        professorLabel: "partial",
        confidence: 0.8,
        phaseComplete: true,
        tutorQuality: {
          naturalness: 4,
          specificity: 4,
          nonLeading: 4,
          challengeFit: 4,
          helpfulness: 4,
          failureTags: ["leading"],
        },
      },
      {
        aiLabel: "vague",
        professorLabel: "wrong",
        confidence: 0.2,
        phaseComplete: true,
        tutorQuality: { naturalness: 2 },
      },
      // This turn contributes to neither calibration nor false-advance rates.
      { aiLabel: "wrong", confidence: 0.1, phaseComplete: true },
      // Invalid labels are treated like missing labels rather than throwing.
      { aiLabel: "not-a-label", professorLabel: "unknown", confidence: 2 },
    ];

    const metrics = computeHumanizationMetrics(records);
    expect(metrics).toMatchObject({
      coverage: 4 / 6,
      exactAgreement: 1 / 4,
      balancedAccuracy: (0.5 + 0 + 0) / 3,
      meanAbsoluteError: (0 + 30 + 70 + 40) / 4,
      signedBias: (0 - 30 - 70 + 40) / 4,
      falseAdvanceRate: 2 / 3,
      meanTutorQuality: 66 / 16,
      humanizationPassRate: 1 / 4,
    });
    expect(metrics.brierScore).toBeCloseTo((0.01 + 0.16 + 0.64 + 0.04) / 4, 12);
  });

  it("calculates balanced accuracy across represented professor classes", () => {
    const records: HumanizationMetricRecord[] = [
      { aiLabel: "correct", professorLabel: "correct" },
      { aiLabel: "wrong", professorLabel: "correct" },
      { aiLabel: "partial", professorLabel: "partial" },
      { aiLabel: "partial", professorLabel: "vague" },
      { aiLabel: "wrong", professorLabel: "wrong" },
    ];

    // Recalls: correct 1/2, partial 1, vague 0, wrong 1; macro average = 5/8.
    expect(computeHumanizationMetrics(records).balancedAccuracy).toBe(5 / 8);
  });

  it("requires all five ratings and no failure tags for a pass", () => {
    const allHigh = {
      naturalness: 4,
      specificity: 4,
      nonLeading: 4,
      challengeFit: 4,
      helpfulness: 4,
    };
    const metrics = computeHumanizationMetrics([
      { tutorQuality: allHigh },
      { tutorQuality: { ...allHigh, failureTags: ["generic"] } },
      { tutorQuality: { ...allHigh, helpfulness: 3 } },
      { tutorQuality: { naturalness: 5 } },
      { tutorQuality: {} },
    ]);

    expect(metrics.meanTutorQuality).toBe((20 + 20 + 19 + 5) / 16);
    expect(metrics.humanizationPassRate).toBe(1 / 4);
  });
});
