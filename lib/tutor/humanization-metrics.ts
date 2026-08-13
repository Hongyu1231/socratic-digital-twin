import { CLASSIFICATION_SCORES } from "@/lib/domain";

/**
 * The labels used by the tutor's answer classifier.  This is intentionally
 * local to the offline metrics module so callers do not need to depend on the
 * rest of the domain model.
 */
export type HumanizationLabel = "correct" | "partial" | "vague" | "wrong";

export type HumanizationTutorQuality = {
  naturalness?: number | null;
  specificity?: number | null;
  nonLeading?: number | null;
  challengeFit?: number | null;
  helpfulness?: number | null;
  /** Any non-empty failure tag makes the turn fail the humanization gate. */
  failureTags?: readonly string[] | null;
};

/** A single offline evaluation record. Missing fields are tolerated. */
export type HumanizationMetricRecord = {
  aiLabel?: string | null;
  professorLabel?: string | null;
  confidence?: number | null;
  phaseComplete?: boolean | null;
  tutorQuality?: HumanizationTutorQuality | null;
};

/**
 * Aggregate offline quality metrics. A null value means that the relevant
 * denominator had no usable observations, rather than that the score was 0.
 */
export type HumanizationMetrics = {
  coverage: number | null;
  exactAgreement: number | null;
  balancedAccuracy: number | null;
  meanAbsoluteError: number | null;
  signedBias: number | null;
  brierScore: number | null;
  falseAdvanceRate: number | null;
  meanTutorQuality: number | null;
  humanizationPassRate: number | null;
};

const LABELS = Object.keys(CLASSIFICATION_SCORES) as HumanizationLabel[];
const QUALITY_DIMENSIONS = [
  "naturalness",
  "specificity",
  "nonLeading",
  "challengeFit",
  "helpfulness",
] as const;
type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

function labelOf(value: unknown): HumanizationLabel | null {
  if (typeof value !== "string") return null;
  return Object.prototype.hasOwnProperty.call(CLASSIFICATION_SCORES, value)
    ? (value as HumanizationLabel)
    : null;
}

function confidenceOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Confidence is specified on [0, 1]. Clamping malformed input keeps one bad
  // record from producing an impossible score or contaminating an aggregate.
  return Math.max(0, Math.min(1, value));
}

function ratingOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 1 && value <= 5 ? value : null;
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function qualityOf(record: HumanizationMetricRecord): HumanizationTutorQuality | null {
  const quality = record.tutorQuality;
  return quality && typeof quality === "object" ? quality : null;
}

/**
 * Compute answer-calibration and tutor-humanization metrics without network or
 * persistence dependencies.
 *
 * Formulas (all averages are arithmetic means):
 * - coverage = records with a valid professor label / all records.
 * - exact agreement = matching AI/professor labels / records with both labels.
 * - balanced accuracy = mean per-class recall, considering classes represented
 *   by professor labels (recall = correct predictions / class support).
 * - mean absolute error = mean |AI score - professor score|, using the domain's
 *   0/40/70/100 CLASSIFICATION_SCORES.
 * - signed bias = mean (AI score - professor score); positive means over-score.
 * - Brier score = mean (confidence - I[AI label = professor label])².
 * - false-advance rate = non-correct professor labels among labelled turns that
 *   the tutor marked phaseComplete.
 * - mean tutor quality = mean of every valid 1–5 quality dimension supplied.
 * - humanization pass rate = turns with quality evidence whose five dimensions
 *   are all at least 4 and whose failure-tag list is empty.
 *
 * Missing/invalid labels, confidences, and ratings are excluded from the
 * denominator that requires them. Thus incomplete records cannot yield NaN.
 */
export function computeHumanizationMetrics(
  records: readonly HumanizationMetricRecord[] | null | undefined,
): HumanizationMetrics {
  const source = Array.isArray(records) ? records : [];
  const labelled = source
    .map((record) => ({ record, professorLabel: labelOf(record?.professorLabel) }))
    .filter((entry): entry is { record: HumanizationMetricRecord; professorLabel: HumanizationLabel } => Boolean(entry.professorLabel));

  const calibration = labelled
    .map(({ record, professorLabel }) => ({
      record,
      professorLabel,
      aiLabel: labelOf(record?.aiLabel),
    }))
    .filter(
      (entry): entry is {
        record: HumanizationMetricRecord;
        professorLabel: HumanizationLabel;
        aiLabel: HumanizationLabel;
      } => Boolean(entry.aiLabel),
    );

  const exactAgreement = mean(
    calibration.map(({ aiLabel, professorLabel }) => (aiLabel === professorLabel ? 1 : 0)),
  );

  // Macro recall gives each professor-represented class equal weight while
  // avoiding an artificial penalty for classes absent from this sample.
  const recalls = LABELS.map((label) => {
    const classRecords = calibration.filter((entry) => entry.professorLabel === label);
    if (!classRecords.length) return null;
    return classRecords.filter((entry) => entry.aiLabel === label).length / classRecords.length;
  }).filter((recall): recall is number => recall !== null);

  const scoreError = calibration.map(
    ({ aiLabel, professorLabel }) => CLASSIFICATION_SCORES[aiLabel] - CLASSIFICATION_SCORES[professorLabel],
  );
  const confidenceErrors = calibration
    .map(({ record, aiLabel, professorLabel }) => {
      const confidence = confidenceOf(record?.confidence);
      return confidence === null ? null : (confidence - (aiLabel === professorLabel ? 1 : 0)) ** 2;
    })
    .filter((error): error is number => error !== null);

  const phaseCompleteLabelled = labelled.filter(({ record }) => record?.phaseComplete === true);
  const falseAdvances = phaseCompleteLabelled.filter(({ professorLabel }) => professorLabel !== "correct");

  const qualityValues: number[] = [];
  let qualityTurnCount = 0;
  let qualityPassCount = 0;
  for (const record of source) {
    const quality = qualityOf(record);
    if (!quality) continue;

    const ratings = QUALITY_DIMENSIONS.map((dimension) => ({
      dimension,
      value: ratingOf(quality[dimension]),
    }));
    const validRatings = ratings.filter(
      (rating): rating is { dimension: QualityDimension; value: number } => rating.value !== null,
    );
    qualityValues.push(...validRatings.map((rating) => rating.value));

    const tags = Array.isArray(quality.failureTags) ? quality.failureTags : [];
    // An object with at least one rating or a failure tag is an evaluated turn;
    // an empty object carries no evidence and is left out of pass-rate scoring.
    if (!validRatings.length && !tags.length) continue;
    qualityTurnCount += 1;
    const allDimensionsPass = QUALITY_DIMENSIONS.every((dimension) => {
      const value = ratingOf(quality[dimension]);
      return value !== null && value >= 4;
    });
    if (allDimensionsPass && tags.length === 0) qualityPassCount += 1;
  }

  return {
    coverage: source.length ? labelled.length / source.length : null,
    exactAgreement,
    balancedAccuracy: mean(recalls),
    meanAbsoluteError: mean(scoreError.map((error) => Math.abs(error))),
    signedBias: mean(scoreError),
    brierScore: mean(confidenceErrors),
    falseAdvanceRate: phaseCompleteLabelled.length
      ? falseAdvances.length / phaseCompleteLabelled.length
      : null,
    meanTutorQuality: mean(qualityValues),
    humanizationPassRate: qualityTurnCount ? qualityPassCount / qualityTurnCount : null,
  };
}
