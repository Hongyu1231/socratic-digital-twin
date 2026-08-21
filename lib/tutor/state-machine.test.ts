import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TutorEvaluationResult } from "@/lib/domain";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { resetRepositoryForTests } from "@/lib/repository";
import { DEMO_PROFESSOR_ID, DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, impactedCanineCase } from "@/lib/seed";
import * as tutor from "@/lib/tutor";
import { finishSession, submitStudentAnswer } from "@/lib/tutor/state-machine";

const evaluationResult = (overrides: Partial<TutorEvaluationResult> = {}): TutorEvaluationResult => ({
  classification: "wrong",
  confidence: 0.95,
  reasoningGap: "The claim conflicts with the relevant clinical evidence.",
  strategy: "probe",
  feedback: "What evidence would support that claim?",
  nextQuestion: "What evidence would support that claim?",
  memoryPatch: {
    addErrors: ["Unsupported absolute claim"],
    addStrengths: [],
    addWeaknesses: ["Needs to test the claim against the radiographic evidence"],
    masteryDelta: 0,
  },
  source: "deterministic",
  ...overrides,
});

describe("Socratic state machine", () => {
  let repository: InMemoryTutorRepository;
  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
  });
  it("advances on a well-supported answer and remembers a strength", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const updated = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The unerupted canine and eruption asymmetry matter because this age and timing make an impaction more likely than normal variation.");
    expect(updated.session.currentPhase).toBe(2);
    expect(updated.session.state.strengths.length).toBe(1);
    expect(updated.session.messages).toHaveLength(3);
    expect(updated.session.messages.at(-1)?.content).toBe("What assumption in that reasoning would be most important to verify?");
    expect(updated.session.messages.at(-1)?.content).not.toBe(impactedCanineCase.phases[1].starterQuestion);
  });
  it("moves on after three unresolved attempts without losing the gap", async () => {
    let bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    for (const answer of ["I am unsure.", "Maybe something is wrong.", "I still do not know."]) {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    }
    expect(bundle.session.currentPhase).toBe(2);
    expect(bundle.session.state.phaseAttempts["1"]).toBe(3);
  });
  it("returns the same committed turn for a duplicate request id", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const requestId = "duplicate-request-123";
    const first = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The canine is unerupted and could represent delayed eruption.", requestId);
    const second = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The canine is unerupted and could represent delayed eruption.", requestId);
    expect(second.session.messages).toHaveLength(first.session.messages.length);
  });
  it("blocks answers while paused and continues from the same state after resume", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const version = started.session.state.version;
    await repository.setSessionPaused(started.session.id, new Date().toISOString());

    await expect(submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The eruption is delayed and asymmetric.")).rejects.toThrow(
      "Resume this session before submitting another answer.",
    );

    const resumed = await repository.setSessionPaused(started.session.id, null);
    expect(resumed.session.state.version).toBe(version);
    const answered = await submitStudentAnswer(resumed.session.id, DEMO_STUDENT_ID, "The unerupted canine and eruption asymmetry make impaction more likely at this age.");
    expect(answered.session.messages).toHaveLength(3);
  });
  it("explicitly corrects a second consecutive high-confidence wrong answer in the same phase", async () => {
    const evaluateSpy = vi.spyOn(tutor, "evaluateWithFallback");
    evaluateSpy
      .mockResolvedValueOnce(evaluationResult({ nextQuestion: "What evidence supports that statement?" }))
      .mockResolvedValueOnce(evaluationResult({ nextQuestion: "Which finding would test that claim?" }));
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);

    const first = await submitStudentAnswer(
      started.session.id,
      DEMO_STUDENT_ID,
      "Impacted canines never resorb lateral incisor roots.",
    );
    expect(first.session.messages.at(-1)?.content).toBe("What evidence supports that statement?");
    expect(first.session.messages.at(-1)?.content).not.toContain("That statement is incorrect.");

    const second = await submitStudentAnswer(
      started.session.id,
      DEMO_STUDENT_ID,
      "I still think impacted canines never resorb lateral incisor roots.",
    );
    expect(second.session.messages.at(-1)?.content).toBe(
      "That statement is incorrect. Which finding would test that claim?",
    );
    expect(second.session.currentPhase).toBe(1);
    expect(second.session.evaluations.map((evaluation) => evaluation.classification)).toEqual(["wrong", "wrong"]);
  });
  it.each([
    ["partial first", evaluationResult({ classification: "partial", confidence: 0.99 }), evaluationResult()],
    ["vague first", evaluationResult({ classification: "vague", confidence: 0.99 }), evaluationResult()],
    ["low-confidence wrong first", evaluationResult({ classification: "wrong", confidence: 0.84 }), evaluationResult()],
    ["partial second", evaluationResult(), evaluationResult({ classification: "partial", confidence: 0.99 })],
    ["vague second", evaluationResult(), evaluationResult({ classification: "vague", confidence: 0.99 })],
    ["low-confidence wrong second", evaluationResult(), evaluationResult({ classification: "wrong", confidence: 0.84 })],
  ] as const)("does not explicitly correct when %s", async (_label, firstResult, secondResult) => {
    const evaluateSpy = vi.spyOn(tutor, "evaluateWithFallback");
    evaluateSpy
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(secondResult);
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);

    await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The claim is always true.");
    const second = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "I cannot justify it further.");

    expect(second.session.messages.at(-1)?.content).toBe(secondResult.nextQuestion);
    expect(second.session.messages.at(-1)?.content).not.toContain("That statement is incorrect.");
  });
  it("creates a formative partial summary when ended early", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const completed = await finishSession(started.session.id, DEMO_STUDENT_ID);
    expect(completed.session.status).toBe("completed");
    expect(completed.session.summary?.completedAllPhases).toBe(false);
  });
  it("does not call an external model while completing a session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);

    await finishSession(started.session.id, DEMO_STUDENT_ID);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("completes all five phases and generates a full summary", async () => {
    let bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const answers = [
      "The unerupted canine and eruption asymmetry matter because age and eruption timing make an impaction clinically significant rather than normal variation.",
      "I would begin with clinical palpation, then use a panoramic radiograph and parallax to determine position before justifying CBCT for unresolved anatomy.",
      "Root resorption of the adjacent incisor, available space, angulation, patient age and overall prognosis would change the urgency of treatment.",
      "Options include interceptive extraction, creating orthodontic space, surgical exposure with traction, or monitoring when the risk profile supports observation.",
      "The evidence should expose uncertainty and my main assumption; I would compare an alternative and reassess if new findings challenged the decision.",
    ];
    for (const answer of answers) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.status).toBe("completed");
    expect(bundle.session.summary?.completedAllPhases).toBe(true);
    expect(bundle.session.evaluations).toHaveLength(5);
  });
  it("saves professor labels and a final review score", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const answered = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The unerupted canine is delayed and eruption timing at this age is asymmetric, which could indicate an impaction.");
    await finishSession(answered.session.id, DEMO_STUDENT_ID);
    const reviewed = await repository.saveReview({
      sessionId: answered.session.id, professorId: DEMO_PROFESSOR_ID,
      reviews: [{ evaluationId: answered.session.evaluations[0].id, label: "partial", comments: "Needs a clearer consequence." }],
      tutorReviews: [{
        evaluationId: answered.session.evaluations[0].id,
        tutorMessageId: answered.session.messages.at(-1)!.id,
        naturalness: 4,
        specificity: 5,
        nonLeading: 5,
        challengeFit: 4,
        helpfulness: 4,
        failureTags: [],
        preferredRewrite: "What evidence would help you test that concern?",
        comments: "The question follows the learner's reasoning.",
      }],
      overallFeedback: "Good start.", status: "completed",
    });
    expect(reviewed.session.reviewStatus).toBe("completed");
    expect(reviewed.sessionReview?.finalScore).toBe(70);
    expect(reviewed.tutorTurnReviews).toEqual([
      expect.objectContaining({ naturalness: 4, specificity: 5, professorId: DEMO_PROFESSOR_ID }),
    ]);
  });
});
