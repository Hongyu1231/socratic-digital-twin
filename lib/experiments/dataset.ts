import {
  computeHumanizationMetrics,
  type HumanizationLabel,
  type HumanizationMetricRecord,
  type HumanizationMetrics,
  type HumanizationTutorQuality,
} from "@/lib/tutor/humanization-metrics";
import { contentHash, deidentifyText, pseudonymHash, type DeidentifyOptions } from "@/lib/experiments/privacy";

type SourceMessage = {
  id: string;
  sender: "student" | "ai" | string;
  content: string;
  replyToMessageId?: string;
};

type SourceEvaluation = {
  id: string;
  messageId: string;
  classification: string;
  confidence: number;
  phaseComplete: boolean;
  reasoningGap?: string;
  strategy?: string;
  feedback?: string;
  phaseOrder?: number;
  attempt?: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
};

type SourceAnswerReview = {
  evaluationId: string;
  professorId: string;
  label: string;
  comments?: string;
};

type SourceTutorReview = {
  evaluationId: string;
  tutorMessageId?: string;
  professorId: string;
  naturalness?: number;
  specificity?: number;
  nonLeading?: number;
  challengeFit?: number;
  helpfulness?: number;
  failureTags?: readonly string[];
  preferredRewrite?: string;
  comments?: string;
};

export type FrozenSampleSource = {
  id: string;
  studentId?: string;
  caseId?: string;
  messages: readonly SourceMessage[];
  evaluations: readonly SourceEvaluation[];
  answerReviews?: readonly SourceAnswerReview[];
  tutorTurnReviews?: readonly SourceTutorReview[];
};

export type FrozenEvaluationSample = {
  sampleId: string;
  snapshotHash: string;
  phaseOrder?: number;
  attempt?: number;
  provider?: string;
  model?: string;
  promptVersion?: string;
  studentAnswer: string;
  tutorResponse: string;
  aiLabel: HumanizationLabel | null;
  aiConfidence: number | null;
  phaseComplete: boolean;
  reasoningGap: string;
  tutorFeedback: string;
  professorLabel: HumanizationLabel | null;
  professorComments: string;
  reviewerPseudonym: string | null;
  tutorQuality: HumanizationTutorQuality | null;
};

export type FrozenEvaluationSet = {
  datasetId: string;
  schemaVersion: "humanization-v1";
  samples: readonly FrozenEvaluationSample[];
  datasetHash: string;
};

function label(value: string | undefined): HumanizationLabel | null {
  return value === "correct" || value === "partial" || value === "vague" || value === "wrong"
    ? value
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as Readonly<T>;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value as Readonly<T>;
}

/** Canonical JSON with recursively sorted object keys and stable array order. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson only accepts finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson does not accept ${typeof value}`);
}

function deidentify(value: string | undefined, options: DeidentifyOptions): string {
  return deidentifyText(value ?? "", options).text;
}

function qualityFrom(review: SourceTutorReview | undefined, options: DeidentifyOptions): HumanizationTutorQuality | null {
  if (!review) return null;
  const quality: HumanizationTutorQuality = {
    naturalness: finite(review.naturalness),
    specificity: finite(review.specificity),
    nonLeading: finite(review.nonLeading),
    challengeFit: finite(review.challengeFit),
    helpfulness: finite(review.helpfulness),
    failureTags: Array.isArray(review.failureTags) ? [...review.failureTags].sort() : [],
  };
  if (review.preferredRewrite) (quality as HumanizationTutorQuality & { preferredRewrite?: string }).preferredRewrite = deidentify(review.preferredRewrite, options);
  if (review.comments) (quality as HumanizationTutorQuality & { comments?: string }).comments = deidentify(review.comments, options);
  return quality;
}

function tutorMessageFor(messages: readonly SourceMessage[], evaluation: SourceEvaluation): SourceMessage | undefined {
  return messages.find(
    (message) => message.sender === "ai" && message.replyToMessageId === evaluation.messageId,
  );
}

/**
 * Build one privacy-preserving, immutable sample per evaluated student turn.
 * Raw IDs and reviewer IDs never appear in the result; only keyed pseudonyms
 * are retained for stable joins and rater-counting.
 */
export function buildFrozenEvaluationSamples(
  source: FrozenSampleSource,
  options: DeidentifyOptions = {},
): readonly FrozenEvaluationSample[] {
  const answerReviews = new Map((source.answerReviews ?? []).map((review) => [review.evaluationId, review]));
  const tutorReviews = new Map((source.tutorTurnReviews ?? []).map((review) => [review.evaluationId, review]));
  const messages = new Map(source.messages.map((message) => [message.id, message]));

  const samples = source.evaluations.map((evaluation) => {
    const answer = messages.get(evaluation.messageId);
    const tutor = tutorMessageFor(source.messages, evaluation);
    const answerReview = answerReviews.get(evaluation.id);
    const tutorReview = tutorReviews.get(evaluation.id);
    const raw = {
      sampleId: pseudonymHash(`${source.id}:${evaluation.id}`, options.salt),
      phaseOrder: evaluation.phaseOrder,
      attempt: evaluation.attempt,
      provider: evaluation.provider,
      model: evaluation.model,
      promptVersion: evaluation.promptVersion,
      studentAnswer: deidentify(answer?.content, options),
      tutorResponse: deidentify(tutor?.content, options),
      aiLabel: label(evaluation.classification),
      aiConfidence: finite(evaluation.confidence),
      phaseComplete: evaluation.phaseComplete === true,
      reasoningGap: deidentify(evaluation.reasoningGap, options),
      tutorFeedback: deidentify(evaluation.feedback, options),
      professorLabel: label(answerReview?.label),
      professorComments: deidentify(answerReview?.comments, options),
      reviewerPseudonym: answerReview?.professorId
        ? pseudonymHash(answerReview.professorId, options.salt)
        : tutorReview?.professorId
          ? pseudonymHash(tutorReview.professorId, options.salt)
          : null,
      tutorQuality: qualityFrom(tutorReview, options),
    } satisfies Omit<FrozenEvaluationSample, "snapshotHash">;
    const snapshotHash = contentHash(canonicalJson(raw));
    return deepFreeze({ ...raw, snapshotHash }) as FrozenEvaluationSample;
  });

  return deepFreeze(samples) as readonly FrozenEvaluationSample[];
}

/** Create a content-addressed, immutable dataset from one or more sessions. */
export function freezeEvaluationSet(
  datasetId: string,
  sources: readonly FrozenSampleSource[],
  options: DeidentifyOptions = {},
): Readonly<FrozenEvaluationSet> {
  const samples = sources
    .flatMap((source) => buildFrozenEvaluationSamples(source, options))
    .sort((left, right) => left.sampleId.localeCompare(right.sampleId));
  const dataset = {
    datasetId: pseudonymHash(datasetId, options.salt),
    schemaVersion: "humanization-v1" as const,
    samples,
    datasetHash: contentHash(canonicalJson(samples)),
  } satisfies FrozenEvaluationSet;
  return deepFreeze(dataset) as Readonly<FrozenEvaluationSet>;
}

export function recordsFromFrozenSamples(
  samples: readonly FrozenEvaluationSample[] | FrozenEvaluationSet,
): HumanizationMetricRecord[] {
  const source: readonly FrozenEvaluationSample[] = Array.isArray(samples)
    ? samples
    : (samples as FrozenEvaluationSet).samples;
  return source.map((sample) => ({
    aiLabel: sample.aiLabel,
    professorLabel: sample.professorLabel,
    confidence: sample.aiConfidence,
    phaseComplete: sample.phaseComplete,
    tutorQuality: sample.tutorQuality,
  }));
}

export function aggregateFrozenMetrics(
  samples: readonly FrozenEvaluationSample[] | FrozenEvaluationSet,
): HumanizationMetrics {
  return computeHumanizationMetrics(recordsFromFrozenSamples(samples));
}
