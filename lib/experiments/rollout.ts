import { contentHash } from "@/lib/experiments/privacy";
import {
  aggregateFrozenMetrics,
  type FrozenEvaluationSample,
  type FrozenEvaluationSet,
} from "@/lib/experiments/dataset";
import type { HumanizationMetrics } from "@/lib/tutor/humanization-metrics";

export type CandidateSpec = {
  id: string;
  promptVersion: string;
  model: string;
  /** Optional build metadata; it is included in the comparison identity. */
  metadata?: Readonly<Record<string, string>>;
};

export type CandidateComparison = {
  candidate: CandidateSpec;
  metrics: HumanizationMetrics;
  sampleCount: number;
  comparisonHash: string;
};

function sampleForCandidate(sample: FrozenEvaluationSample): FrozenEvaluationSample {
  // Frozen samples may be collected from a production baseline.  A candidate
  // run can attach labels/ratings separately; this function deliberately does
  // not mutate or reinterpret observations. It is useful for comparing a
  // candidate's metric report with an immutable holdout.
  return sample;
}

export function compareCandidates(
  candidates: readonly CandidateSpec[],
  datasets: Readonly<Record<string, FrozenEvaluationSet | readonly FrozenEvaluationSample[]>>,
): readonly CandidateComparison[] {
  return candidates.map((candidate) => {
    const dataset = datasets[candidate.id];
    if (!dataset) throw new Error(`No frozen dataset supplied for candidate ${candidate.id}`);
    const samples = ("samples" in dataset ? dataset.samples : dataset) as readonly FrozenEvaluationSample[];
    const observed = samples.map(sampleForCandidate);
    const metrics = aggregateFrozenMetrics(observed);
    return Object.freeze({
      candidate: Object.freeze({ ...candidate, metadata: candidate.metadata ? Object.freeze({ ...candidate.metadata }) : undefined }),
      metrics,
      sampleCount: observed.length,
      comparisonHash: contentHash(JSON.stringify({ candidate, sampleHashes: observed.map((sample) => sample.snapshotHash) })),
    });
  });
}

export type ExperimentArm = "control" | "candidate";

/** Deterministically assign a stable subject to an experiment arm. */
export function assignExperimentArm(
  subjectId: string,
  experimentId: string,
  candidatePercent = 10,
): ExperimentArm {
  if (!Number.isInteger(candidatePercent) || candidatePercent < 0 || candidatePercent > 100) {
    throw new RangeError("candidatePercent must be an integer between 0 and 100");
  }
  const digest = contentHash(`${experimentId}:${subjectId}`);
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % 100;
  return bucket < candidatePercent ? "candidate" : "control";
}

export type TutorRunResult = {
  classification: string;
  confidence: number;
  phaseComplete: boolean;
  nextQuestion: string;
  source: string;
  [key: string]: unknown;
};

export type ShadowComparison = {
  equalClassification: boolean;
  confidenceDelta: number;
  phaseCompletionChanged: boolean;
  nextQuestionChanged: boolean;
  safetyRegression: boolean;
  studentVisible: TutorRunResult;
  shadow: TutorRunResult;
};

/**
 * Compare a shadow run without allowing it to alter the student-visible run.
 * The returned visible result is the same object reference and should be the
 * only result persisted by a caller.
 */
export function compareShadowResults(
  studentVisible: TutorRunResult,
  shadow: TutorRunResult,
  safety?: (result: TutorRunResult) => boolean,
): ShadowComparison {
  const isSafe = safety ?? ((result) => result.nextQuestion.trim().length > 0 && result.nextQuestion.split("?").length - 1 <= 1);
  return Object.freeze({
    equalClassification: studentVisible.classification === shadow.classification,
    confidenceDelta: shadow.confidence - studentVisible.confidence,
    phaseCompletionChanged: studentVisible.phaseComplete !== shadow.phaseComplete,
    nextQuestionChanged: studentVisible.nextQuestion !== shadow.nextQuestion,
    safetyRegression: isSafe(studentVisible) && !isSafe(shadow),
    studentVisible,
    shadow,
  });
}

export type ReleaseGateThresholds = {
  minSamples: number;
  minCoverage: number;
  minAgreement: number;
  maxFalseAdvanceRate: number;
  minHumanizationPassRate: number;
  maxMeanAbsoluteError: number;
  maxBrierScore: number;
};

export type ReleaseGateInput = {
  candidate: CandidateSpec;
  metrics: HumanizationMetrics;
  sampleCount: number;
  /** Number of distinct professors whose labels are represented. */
  distinctReviewers: number;
  /** A single professor review can never make a release eligible. */
  approvedByFaculty: boolean;
  safetyRegression: boolean;
  baseline?: HumanizationMetrics | null;
};

export type ReleaseGateResult = {
  eligible: boolean;
  reasons: readonly string[];
  thresholds: ReleaseGateThresholds;
};

const DEFAULT_THRESHOLDS: ReleaseGateThresholds = {
  minSamples: 20,
  minCoverage: 0.8,
  minAgreement: 0.8,
  maxFalseAdvanceRate: 0.05,
  minHumanizationPassRate: 0.7,
  maxMeanAbsoluteError: 20,
  maxBrierScore: 0.2,
};

function meets(value: number | null, predicate: (value: number) => boolean): boolean {
  return value !== null && Number.isFinite(value) && predicate(value);
}

/** Conservative publication gate; no mutation or model calls occur here. */
export function evaluateReleaseGate(
  input: ReleaseGateInput,
  customThresholds: Partial<ReleaseGateThresholds> = {},
): ReleaseGateResult {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...customThresholds };
  const reasons: string[] = [];
  if (input.sampleCount < thresholds.minSamples) reasons.push("minimum sample count not met");
  if (input.distinctReviewers < 2) reasons.push("at least two distinct faculty reviewers are required");
  if (!input.approvedByFaculty) reasons.push("explicit faculty approval is required");
  if (input.safetyRegression) reasons.push("shadow run has a safety regression");
  if (!meets(input.metrics.coverage, (value) => value >= thresholds.minCoverage)) reasons.push("coverage below threshold");
  if (!meets(input.metrics.exactAgreement, (value) => value >= thresholds.minAgreement)) reasons.push("agreement below threshold");
  if (!meets(input.metrics.falseAdvanceRate, (value) => value <= thresholds.maxFalseAdvanceRate)) reasons.push("false-advance rate above threshold");
  if (!meets(input.metrics.humanizationPassRate, (value) => value >= thresholds.minHumanizationPassRate)) reasons.push("humanization quality below threshold");
  if (!meets(input.metrics.meanAbsoluteError, (value) => value <= thresholds.maxMeanAbsoluteError)) reasons.push("mean absolute error above threshold");
  if (!meets(input.metrics.brierScore, (value) => value <= thresholds.maxBrierScore)) reasons.push("Brier score above threshold");

  // A candidate is not eligible merely because it clears absolute thresholds:
  // regressions against the current production baseline are blocked as well.
  if (input.baseline) {
    if (input.metrics.exactAgreement !== null && input.baseline.exactAgreement !== null && input.metrics.exactAgreement < input.baseline.exactAgreement) reasons.push("agreement regresses against baseline");
    if (input.metrics.falseAdvanceRate !== null && input.baseline.falseAdvanceRate !== null && input.metrics.falseAdvanceRate > input.baseline.falseAdvanceRate) reasons.push("false-advance rate regresses against baseline");
    if (input.metrics.humanizationPassRate !== null && input.baseline.humanizationPassRate !== null && input.metrics.humanizationPassRate < input.baseline.humanizationPassRate) reasons.push("humanization quality regresses against baseline");
  }
  return Object.freeze({ eligible: reasons.length === 0, reasons: Object.freeze(reasons), thresholds: Object.freeze(thresholds) });
}

export type RollbackInput = {
  current: HumanizationMetrics;
  baseline: HumanizationMetrics;
  safetyRegression: boolean;
  minimumRelativeAgreementDrop?: number;
  minimumRelativeQualityDrop?: number;
};

export type RollbackDecision = {
  rollback: boolean;
  reasons: readonly string[];
};

export function decideRollback(input: RollbackInput): RollbackDecision {
  const reasons: string[] = [];
  const agreementDrop =
    input.current.exactAgreement !== null && input.baseline.exactAgreement !== null
      ? input.baseline.exactAgreement - input.current.exactAgreement
      : 0;
  const qualityDrop =
    input.current.humanizationPassRate !== null && input.baseline.humanizationPassRate !== null
      ? input.baseline.humanizationPassRate - input.current.humanizationPassRate
      : 0;
  if (input.safetyRegression) reasons.push("safety regression detected");
  if (agreementDrop >= (input.minimumRelativeAgreementDrop ?? 0.05)) reasons.push("answer agreement dropped materially");
  if (qualityDrop >= (input.minimumRelativeQualityDrop ?? 0.1)) reasons.push("humanization quality dropped materially");
  return Object.freeze({ rollback: reasons.length > 0, reasons: Object.freeze(reasons) });
}
