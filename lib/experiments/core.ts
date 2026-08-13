import type { SessionBundle, TutorEvaluationResult } from "@/lib/domain";
import { contentHash, deidentifyText, pseudonymHash } from "@/lib/experiments/privacy";
import {
  canonicalJson,
} from "@/lib/experiments/dataset";
import { runCandidateOnSample } from "@/lib/experiments/candidate-runner";
import type {
  EvalRun,
  FrozenTutorSample,
  ReleaseGateResult,
  TutorCandidate,
} from "@/lib/experiments/types";
import { computeHumanizationMetrics, type HumanizationMetricRecord } from "@/lib/tutor/humanization-metrics";

/** Stable, content-addressed JSON hash used for datasets and sample entries. */
export function canonicalHash(value: unknown): string {
  return contentHash(canonicalJson(value));
}

export function deidentifiedDatasetName(value: string): string {
  const name = deidentifyText(value, { salt: "dataset-name-v1" }).text.trim().slice(0, 120);
  return name || "Frozen tutor evaluation set";
}

function tutorReply(session: SessionBundle["session"], evaluationMessageId: string): string {
  return session.messages.find(
    (message) => message.sender === "ai" && message.replyToMessageId === evaluationMessageId,
  )?.content ?? "";
}

/** Convert professor-labelled session bundles into the legacy experiment DTO. */
export function buildFrozenSamples(sessions: readonly SessionBundle[], pseudonymSalt = "socratic-experiment-dev-v1"): FrozenTutorSample[] {
  const samples: FrozenTutorSample[] = [];
  for (const bundle of sessions) {
    const answerReviews = new Map(bundle.answerReviews.map((review) => [review.evaluationId, review]));
    const tutorReviews = new Map(bundle.tutorTurnReviews.map((review) => [review.evaluationId, review]));
    for (const evaluation of bundle.session.evaluations) {
      const review = answerReviews.get(evaluation.id);
      if (!review) continue;
      const phase = bundle.case.phases.find((item) => item.order === (evaluation.phaseOrder ?? bundle.session.currentPhase)) ?? bundle.case.phases[0];
      if (!phase) continue;
      const tutorReview = tutorReviews.get(evaluation.id);
      const answer = bundle.session.messages.find((message) => message.id === evaluation.messageId)?.content ?? "";
      const sampleKey = `${pseudonymHash(bundle.session.studentId, pseudonymSalt)}:${pseudonymHash(evaluation.id, pseudonymSalt)}`;
      samples.push({
        sampleKey,
        reviewerPseudonym: pseudonymHash(review.professorId, pseudonymSalt),
        phase: { title: phase.title, goal: phase.goal, rubric: [...phase.rubric] },
        answer: deidentifyText(answer, { knownNames: [bundle.student.name], knownIdentifiers: [bundle.student.email, bundle.session.studentId], salt: pseudonymSalt }).text,
        attempt: evaluation.attempt ?? 1,
        professorLabel: review.label,
        baseline: {
          aiLabel: evaluation.classification,
          confidence: evaluation.confidence,
          phaseComplete: evaluation.phaseComplete,
          tutorReply: deidentifyText(tutorReply(bundle.session, evaluation.messageId), { knownNames: [bundle.student.name], knownIdentifiers: [bundle.student.email, bundle.session.studentId], salt: pseudonymSalt }).text,
          provider: evaluation.provider ?? bundle.runtime.tutor,
          model: evaluation.model ?? "unknown",
          promptVersion: evaluation.promptVersion ?? "legacy",
        },
        tutorQuality: tutorReview
          ? {
              naturalness: tutorReview.naturalness,
              specificity: tutorReview.specificity,
              nonLeading: tutorReview.nonLeading,
              challengeFit: tutorReview.challengeFit,
              helpfulness: tutorReview.helpfulness,
              failureTags: [...tutorReview.failureTags],
            }
          : null,
      });
    }
  }
  return samples;
}

export function deterministicExperimentArm(
  subjectId: string,
  experimentId: string,
  candidatePercent: number,
): "baseline" | "candidate" {
  if (!Number.isInteger(candidatePercent) || candidatePercent < 0 || candidatePercent > 100) {
    throw new RangeError("candidatePercent must be an integer between 0 and 100");
  }
  const bucket = Number.parseInt(contentHash(`${experimentId}:${subjectId}`).slice(0, 8), 16) % 100;
  return bucket < candidatePercent ? "candidate" : "baseline";
}

export function outputSafetyCheck(nextQuestion: string): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const trimmed = nextQuestion.trim();
  if (!trimmed) reasons.push("question is empty");
  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  if (questionMarks !== 1) reasons.push("question must contain exactly one question mark");
  if (trimmed.length > 500) reasons.push("question is too long");
  if (/\b(the diagnosis is|the answer is|therefore it is)\b/i.test(trimmed)) reasons.push("question reveals the answer");
  return { passed: reasons.length === 0, reasons };
}

function metricsForSamples(samples: readonly FrozenTutorSample[], predictions?: readonly TutorEvaluationResult[]): ReturnType<typeof computeHumanizationMetrics> {
  const records: HumanizationMetricRecord[] = samples.map((sample, index) => ({
    aiLabel: predictions?.[index]?.classification ?? sample.baseline.aiLabel,
    professorLabel: sample.professorLabel,
    confidence: predictions?.[index]?.confidence ?? sample.baseline.confidence,
    phaseComplete: predictions?.[index]?.classification ? predictions[index].classification === "correct" : sample.baseline.phaseComplete,
    tutorQuality: sample.tutorQuality,
  }));
  return computeHumanizationMetrics(records);
}

/** Run a candidate against the immutable frozen entries and produce a gate result. */
export async function computeCandidateRun(
  samples: readonly FrozenTutorSample[],
  candidate: TutorCandidate,
): Promise<Pick<EvalRun, "baselineMetrics" | "candidateMetrics" | "metricDeltas" | "gate">> {
  const predictions: TutorEvaluationResult[] = [];
  const safetyResults: Array<{ passed: boolean }> = [];
  for (const sample of samples) {
    try {
      const prediction = await runCandidateOnSample(sample, candidate);
      predictions.push(prediction);
      safetyResults.push(outputSafetyCheck(prediction.nextQuestion));
    } catch {
      // A failed candidate turn is conservatively represented as an unsafe
      // baseline-shaped result; the gate will block the release.
      predictions.push({
        classification: "wrong",
        confidence: 0,
        reasoningGap: "candidate failed",
        strategy: "clarify",
        feedback: "",
        nextQuestion: "",
        memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: [], masteryDelta: 0 },
        source: "deterministic",
      });
      safetyResults.push({ passed: false });
    }
  }
  const baselineMetrics = metricsForSamples(samples);
  const automatedCandidateMetrics = metricsForSamples(samples, predictions);
  const safetyPassRate = samples.length ? safetyResults.filter((item) => item.passed).length / samples.length : 0;
  // Historical faculty ratings describe the production reply in the frozen
  // sample, not the newly generated candidate reply. Never copy those ratings
  // onto the candidate. Actual candidate ratings arrive from limited A/B.
  const candidateMetrics = {
    ...automatedCandidateMetrics,
    meanTutorQuality: null,
    humanizationPassRate: safetyPassRate,
  };
  const metricDeltas = Object.fromEntries(
    (Object.keys(candidateMetrics) as Array<keyof typeof candidateMetrics>).map((key) => [
      key,
      baselineMetrics[key] === null || candidateMetrics[key] === null ? null : candidateMetrics[key]! - baselineMetrics[key]!,
    ]),
  );
  const distinctReviewerCount = new Set(samples.map((sample) => sample.reviewerPseudonym)).size;
  const gate: ReleaseGateResult = {
    passed:
      samples.length >= 20 &&
      distinctReviewerCount >= 2 &&
      safetyPassRate === 1 &&
      (candidateMetrics.exactAgreement ?? 0) >= 0.8 &&
      (candidateMetrics.falseAdvanceRate ?? 1) <= 0.05 &&
      (candidateMetrics.humanizationPassRate ?? 0) >= 0.7,
    reasons: [],
    sampleCount: samples.length,
    safetyPassRate,
    distinctReviewerCount,
    requiresObservedFacultyApproval: true,
  };
  if (samples.length < 20) gate.reasons.push("minimum sample count not met");
  if (distinctReviewerCount < 2) gate.reasons.push("at least two distinct faculty reviewers are required");
  if (safetyPassRate < 1) gate.reasons.push("candidate safety output failed");
  if ((candidateMetrics.exactAgreement ?? 0) < 0.8) gate.reasons.push("agreement below threshold");
  if ((candidateMetrics.falseAdvanceRate ?? 1) > 0.05) gate.reasons.push("false-advance rate above threshold");
  if ((candidateMetrics.humanizationPassRate ?? 0) < 0.7) gate.reasons.push("humanization quality below threshold");
  return { baselineMetrics, candidateMetrics, metricDeltas, gate };
}
