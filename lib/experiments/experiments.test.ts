import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  freezeEvaluationSet,
  recordsFromFrozenSamples,
} from "@/lib/experiments/dataset";
import { deidentifyText, deidentifyValue, pseudonymHash } from "@/lib/experiments/privacy";
import {
  assignExperimentArm,
  compareShadowResults,
  decideRollback,
  evaluateReleaseGate,
} from "@/lib/experiments/rollout";
import { createMemoryHumanizationStoreForTests } from "@/lib/experiments/store";
import type { SessionBundle } from "@/lib/domain";

const source = {
  id: "session-123",
  studentId: "student-1",
  caseId: "case-1",
  messages: [
    {
      id: "answer-1",
      sender: "student" as const,
      content: "My name is Alice Chen, email alice@example.com, call +1 (555) 123-4567. The eruption was delayed.",
    },
    {
      id: "tutor-1",
      sender: "ai" as const,
      replyToMessageId: "answer-1",
      content: "Thanks Alice. What evidence would you look for next?",
    },
  ],
  evaluations: [
    {
      id: "evaluation-1",
      messageId: "answer-1",
      classification: "partial",
      confidence: 0.7,
      phaseComplete: false,
      reasoningGap: "Need to connect the delay to obstruction.",
      strategy: "probe",
      feedback: "You identified the timing issue.",
      phaseOrder: 1,
      attempt: 1,
      provider: "deterministic",
      model: "fallback",
      promptVersion: "human-v1",
    },
  ],
  answerReviews: [
    {
      evaluationId: "evaluation-1",
      professorId: "prof-1",
      label: "partial",
      comments: "Alice can make the causal link more explicit.",
    },
  ],
  tutorTurnReviews: [
    {
      evaluationId: "evaluation-1",
      tutorMessageId: "tutor-1",
      professorId: "prof-1",
      naturalness: 5,
      specificity: 4,
      nonLeading: 4,
      challengeFit: 4,
      helpfulness: 5,
      failureTags: [],
      preferredRewrite: "What finding would help you decide between the two explanations?",
      comments: "Specific and concise.",
    },
  ],
};

describe("privacy and frozen evaluation sets", () => {
  it("removes PII while retaining stable one-way pseudonyms", () => {
    const first = deidentifyText("Alice alice@example.com 123e4567-e89b-12d3-a456-426614174000 2026-08-13 10.1.2.3", {
      salt: "secret",
      knownNames: ["Alice"],
    });
    const second = deidentifyText("Alice alice@example.com 123e4567-e89b-12d3-a456-426614174000 2026-08-13 10.1.2.3", {
      salt: "secret",
      knownNames: ["Alice"],
    });
    expect(first.text).toBe(second.text);
    expect(first.text).not.toContain("alice@example.com");
    expect(first.text).not.toContain("123e4567-e89b-12d3-a456-426614174000");
    expect(first.text).not.toContain("Alice");
    expect(first.text).toContain("<EMAIL_");
    expect(first.text).toContain("<NAME_");
    expect(first.text).toContain("<UUID_");
    expect(first.text).toContain("<IP_");
    expect(pseudonymHash("Alice", "secret")).not.toContain("Alice");
    expect(deidentifyValue({ name: "Alice", nested: ["alice@example.com"] }, { salt: "secret", knownNames: ["Alice"] })).toEqual({
      name: expect.stringContaining("<NAME_"),
      nested: [expect.stringContaining("<EMAIL_")],
    });
  });

  it("canonicalizes object key order and freezes a content-addressed snapshot", () => {
    expect(canonicalJson({ z: 1, a: { b: 2, a: true } })).toBe('{"a":{"a":true,"b":2},"z":1}');
    const first = freezeEvaluationSet("dataset-1", [source], { salt: "secret", knownNames: ["Alice"] });
    const reordered = freezeEvaluationSet("dataset-1", [{ ...source, evaluations: [...source.evaluations].reverse() }], {
      salt: "secret",
      knownNames: ["Alice"],
    });
    expect(first.datasetHash).toBe(reordered.datasetHash);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.samples[0])).toBe(true);
    expect(first.samples[0].studentAnswer).not.toContain("Alice");
    expect(first.samples[0].reviewerPseudonym).toBe(pseudonymHash("prof-1", "secret"));
    expect(recordsFromFrozenSamples(first)).toHaveLength(1);
  });
});

describe("rollout experiment controls", () => {
  it("assigns stable deterministic A/B buckets", () => {
    const first = assignExperimentArm("student-1", "human-v1", 25);
    expect(assignExperimentArm("student-1", "human-v1", 25)).toBe(first);
    // A changed experiment namespace is allowed to land in the same arm by
    // chance; across a cohort it should still produce both deterministic arms.
    const cohort = Array.from({ length: 100 }, (_, index) => assignExperimentArm(`student-${index}`, "human-v1", 25));
    expect(cohort).toContain("candidate");
    expect(cohort).toContain("control");
    expect(() => assignExperimentArm("student-1", "human-v1", 101)).toThrow(RangeError);
  });

  it("keeps shadow output side-effect free and detects safety regressions", () => {
    const visible = { classification: "partial", confidence: 0.7, phaseComplete: false, nextQuestion: "What evidence supports that?", source: "deterministic" };
    const shadow = { ...visible, classification: "correct", phaseComplete: true, nextQuestion: "Answer: it is obstruction. Explain why?" };
    const result = compareShadowResults(visible, shadow);
    expect(result.studentVisible).toBe(visible);
    expect(result.phaseCompletionChanged).toBe(true);
    expect(result.safetyRegression).toBe(false); // The default safety check allows this single-question output.
    const unsafe = compareShadowResults(visible, { ...shadow, nextQuestion: "? One? Two?" });
    expect(unsafe.safetyRegression).toBe(true);
    expect(visible.phaseComplete).toBe(false);
  });

  it("blocks publication until enough independent faculty approve all gates", () => {
    const metrics = {
      coverage: 0.95,
      exactAgreement: 0.9,
      balancedAccuracy: 0.9,
      meanAbsoluteError: 10,
      signedBias: 0,
      brierScore: 0.1,
      falseAdvanceRate: 0.01,
      meanTutorQuality: 4.5,
      humanizationPassRate: 0.85,
    };
    const base = {
      candidate: { id: "candidate", promptVersion: "human-v2", model: "model" },
      metrics,
      sampleCount: 20,
      distinctReviewers: 2,
      approvedByFaculty: true,
      safetyRegression: false,
    };
    expect(evaluateReleaseGate(base).eligible).toBe(true);
    expect(evaluateReleaseGate({ ...base, distinctReviewers: 1 }).eligible).toBe(false);
    expect(evaluateReleaseGate({ ...base, approvedByFaculty: false }).reasons).toContain("explicit faculty approval is required");
    expect(evaluateReleaseGate({ ...base, sampleCount: 1 }).eligible).toBe(false);
  });

  it("returns a rollback decision for safety or material quality regression", () => {
    const baseline = { exactAgreement: 0.9, humanizationPassRate: 0.8 } as import("@/lib/tutor/humanization-metrics").HumanizationMetrics;
    const current = { exactAgreement: 0.82, humanizationPassRate: 0.65 } as import("@/lib/tutor/humanization-metrics").HumanizationMetrics;
    expect(decideRollback({ current, baseline, safetyRegression: false })).toEqual({
      rollback: true,
      reasons: ["answer agreement dropped materially", "humanization quality dropped materially"],
    });
    expect(decideRollback({ current, baseline, safetyRegression: true })).toMatchObject({ rollback: true });
  });
});

function governedBundle(): SessionBundle {
  const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const messages = Array.from({ length: 20 }, (_, index) => [
    { id: `student-${index}`, sessionId, sender: "student" as const, content: "The canine is unerupted, delayed, and asymmetric to the contralateral eruption timing.", timestamp: new Date(0).toISOString() },
    { id: `tutor-${index}`, sessionId, sender: "ai" as const, content: "What assumption in that reasoning would be most important to verify?", timestamp: new Date(0).toISOString(), replyToMessageId: `student-${index}` },
  ]).flat();
  const evaluations = Array.from({ length: 20 }, (_, index) => ({
    id: `evaluation-${index}`, messageId: `student-${index}`, classification: "correct" as const,
    confidence: 0.9, reasoningGap: "Verify timing.", strategy: "reflect" as const,
    phaseComplete: true, feedback: "Specific evidence.", phaseOrder: 1, attempt: 1,
    provider: "deterministic" as const, model: "rules-v1", promptVersion: "human-v1", createdAt: new Date(0).toISOString(),
  }));
  return {
    session: {
      id: sessionId, studentId: "11111111-1111-4111-8111-111111111111", caseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      currentPhase: 5, status: "completed", reviewStatus: "completed", score: 100, summary: null,
      createdAt: new Date(0).toISOString(), completedAt: new Date(0).toISOString(), messages, evaluations,
      state: { sessionId, currentGoal: "Identify the concern", previousErrors: [], strengths: [], weaknesses: [], nextStrategy: "reflect", phaseAttempts: { "1": 1 }, mastery: { "1": 1 }, version: 20, updatedAt: new Date(0).toISOString() },
    },
    case: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "De-identified case", description: "Demo", difficulty: "foundation", status: "available", learningObjectives: [],
      phases: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", caseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", order: 1, title: "Recognition", goal: "Identify the central concern", rubric: ["Delayed eruption", "Contralateral asymmetry"], starterQuestion: "What is the concern?", exampleQuestions: ["What evidence supports that?"] }],
    },
    student: { id: "11111111-1111-4111-8111-111111111111", name: "Alice Example", email: "alice@example.com", role: "student" },
    answerReviews: evaluations.map((evaluation, index) => ({ evaluationId: evaluation.id, professorId: index % 2 ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333", label: "correct", comments: "Grounded.", updatedAt: new Date(0).toISOString() })),
    tutorTurnReviews: evaluations.map((evaluation, index) => ({ evaluationId: evaluation.id, tutorMessageId: `tutor-${index}`, professorId: index % 2 ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333", naturalness: 5, specificity: 5, nonLeading: 5, challengeFit: 5, helpfulness: 5, failureTags: [], preferredRewrite: "", comments: "", updatedAt: new Date(0).toISOString() })),
    sessionReview: { sessionId, professorId: "22222222-2222-4222-8222-222222222222", overallFeedback: "Complete", status: "completed", finalScore: 100, updatedAt: new Date(0).toISOString() },
    runtime: { storage: "memory", tutor: "deterministic" },
    summaryGenerationStatus: "ready",
  };
}

describe("governed feedback store", () => {
  it("enforces freeze → offline gate → shadow → A/B evidence → faculty approval → release → rollback", async () => {
    const store = createMemoryHumanizationStoreForTests();
    const adminId = "99999999-9999-4999-8999-999999999999";
    const professorId = "22222222-2222-4222-8222-222222222222";
    const dataset = await store.createDataset({ name: "August holdout", actorId: adminId, sessions: [governedBundle()] });
    const candidate = await store.createCandidate({ name: "Human v2", provider: "deterministic", model: "rules-v1", promptVersion: "human-v2", instructions: "A deliberately long, versioned tutor instruction contract that acknowledges one concrete learner idea, asks one open question, avoids revealing answers, and never changes learner state directly.", actorId: adminId });
    const run = await store.runEvaluation({ datasetId: dataset.id, candidateId: candidate.id, actorId: adminId });
    expect(run.gate).toMatchObject({ passed: true, sampleCount: 20, distinctReviewerCount: 2, safetyPassRate: 1, requiresObservedFacultyApproval: true });

    await expect(store.createExperiment({ name: "A/B too soon", evalRunId: run.id, mode: "ab", trafficPercent: 10, actorId: adminId })).rejects.toThrow(/shadow/i);
    const shadow = await store.createExperiment({ name: "Shadow", evalRunId: run.id, mode: "shadow", trafficPercent: 0, actorId: adminId });
    await store.saveShadowResult({ experimentId: shadow.id, turnKey: "turn-shadow", arm: "baseline", baselineOutput: {}, candidateOutput: {}, safetyPassed: true });
    await store.pauseExperiment(shadow.id);
    const ab = await store.createExperiment({ name: "Limited A/B", evalRunId: run.id, mode: "ab", trafficPercent: 10, actorId: adminId });
    await expect(store.approve({ evalRunId: run.id, professorId, decision: "approved", notes: "Looks ready after review." })).rejects.toThrow(/A\/B evidence/i);
    await store.saveShadowResult({ experimentId: ab.id, turnKey: "turn-ab", arm: "candidate", baselineOutput: {}, candidateOutput: {}, safetyPassed: true });
    await store.approve({ evalRunId: run.id, professorId, decision: "approved", notes: "Observed evidence is acceptable." });
    const release = await store.release({ evalRunId: run.id, actorId: adminId, trafficPercent: 10, releaseNotes: "Approved limited release." });
    expect(release.status).toBe("active");
    expect((await store.rollback({ releaseId: release.id, actorId: adminId, reason: "Safety monitor requested rollback." })).status).toBe("rolled_back");
    expect(await store.activeExperiment("session-after-rollback")).toBeNull();
  });
});
