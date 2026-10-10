import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalCase, TutorEvaluationResult } from "@/lib/domain";
import { DEMO_STUDENT_ID } from "@/lib/seed";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { resetRepositoryForTests } from "@/lib/repository";
import * as tutor from "@/lib/tutor";
import * as support from "@/lib/tutor/support";
import { studentView } from "@/lib/http";
import {
  HELP_REQUEST_MARKER,
  HelpGenerationRetryableError,
  canRequestHelp,
  submitStudentAnswer,
  submitTutorHelp,
} from "@/lib/tutor/state-machine";

const answerResult = (patch: Partial<TutorEvaluationResult> = {}): TutorEvaluationResult => ({
  classification: "partial",
  confidence: 0.8,
  reasoningGap: "Needs supporting evidence.",
  misconceptionKey: null,
  strategy: "probe",
  feedback: "One link remains unclear.",
  nextQuestion: "What evidence supports that conclusion?",
  criteriaMet: [],
  source: "deterministic",
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: [], masteryDelta: 0 },
  ...patch,
});

describe("ungraded Help turns", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
  });

  afterEach(() => vi.restoreAllMocks());

  async function start() {
    const clinicalCase: ClinicalCase = {
      id: "",
      title: "Help fixture",
      description: "A bounded fixture for explicit Help turns.",
      difficulty: "foundation",
      status: "draft",
      learningObjectives: ["Use the supplied evidence"],
      phases: [{
        id: crypto.randomUUID(),
        caseId: "",
        order: 1,
        title: "Observe",
        goal: "Separate observation from assumption.",
        rubric: [{ id: "observation", text: "Identify the supplied finding.", revealText: "Separate what is observed from an assumed cause." }],
        starterQuestion: "What do you observe?",
        exampleQuestions: ["Which record supports that observation?"],
        phaseCeiling: 5,
      }],
      attachments: [],
      findings: [],
    };
    const saved = await repository.saveCase(clinicalCase, "99999999-9999-4999-8999-999999999999");
    await repository.publishCase(saved.id);
    return repository.createSession(DEMO_STUDENT_ID, saved.id);
  }

  it("keeps Help unavailable before an evaluated answer and does not call generation", async () => {
    const started = await start();
    const generate = vi.spyOn(support, "generateTutorSupport");
    const before = JSON.stringify(started.session);
    const unchanged = await submitTutorHelp(started.session.id, DEMO_STUDENT_ID, "help-before-01");
    expect(JSON.stringify(unchanged.session)).toBe(before);
    expect(studentView(unchanged).session.canRequestHelp).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("commits a tagged ungraded step, replays it, then reaches supported reveal", async () => {
    vi.spyOn(tutor, "getTutorMode").mockReturnValue("openai");
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(answerResult());
    const generate = vi.spyOn(support, "generateTutorSupport")
      .mockResolvedValueOnce({ content: "Suppose this interpretation were incomplete. What would you challenge first?", source: "openai" })
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const started = await start();
    const answered = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The finding is relevant.", "answer-help-01");
    expect(studentView(answered).session.canRequestHelp).toBe(true);
    const attemptsBefore = answered.session.state.phaseAttempts["1"];
    const firstHelp = await submitTutorHelp(answered.session.id, DEMO_STUDENT_ID, "help-turn-01");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(firstHelp.session.evaluations).toHaveLength(1);
    expect(firstHelp.session.state.phaseProgress?.["1"]).toMatchObject({ supportLevel: 1, noProgressCount: 0, completedWithSupport: false });
    expect(firstHelp.session.state.phaseAttempts["1"]).toBe(attemptsBefore);
    expect(firstHelp.session.messages.at(-2)).toMatchObject({
      content: HELP_REQUEST_MARKER, sender: "student", turnKind: "help", helpRequested: true,
      phaseOrder: 1, supportLevel: 1, completedWithSupport: false,
    });
    expect(firstHelp.session.messages.at(-1)).toMatchObject({
      sender: "ai", turnKind: "help", helpRequested: true, moveType: "hypothetical",
      phaseOrder: 1, supportLevel: 1, completedWithSupport: false,
      replyToMessageId: firstHelp.session.messages.at(-2)?.id,
    });
    expect(firstHelp.session.messages.at(-1)?.retrieval).toEqual({ query: "What evidence supports that conclusion? Separate observation from assumption.", passages: [] });
    expect(studentView(firstHelp).session.messages.at(-1)).not.toHaveProperty("retrieval");
    expect((await submitTutorHelp(answered.session.id, DEMO_STUDENT_ID, "help-turn-01")).session).toEqual(firstHelp.session);
    expect(generate).toHaveBeenCalledTimes(1);

    const reveal = await submitTutorHelp(answered.session.id, DEMO_STUDENT_ID, "help-turn-02");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(reveal.session.currentPhase).toBe(answered.session.currentPhase);
    expect(reveal.session.evaluations).toHaveLength(1);
    expect(reveal.session.state.phaseProgress?.["1"]).toMatchObject({
      supportLevel: 2, noProgressCount: 0, awaitingApplication: true, completedWithSupport: true,
    });
    expect(reveal.session.messages.at(-1)).toMatchObject({ moveType: "reveal", supportLevel: 2, completedWithSupport: true });
    expect(reveal.session.messages.at(-1)?.content).toContain("Separate what is observed from an assumed cause.");
    expect(reveal.runtime).toMatchObject({ tutor: "deterministic", fallbackFrom: "openai" });
    expect((await repository.getSession(reveal.session.id))?.runtime).toMatchObject({ tutor: "deterministic", fallbackFrom: "openai" });
    expect((await submitTutorHelp(reveal.session.id, DEMO_STUDENT_ID, "help-turn-02")).runtime).toMatchObject({ tutor: "deterministic", fallbackFrom: "openai" });
    expect(studentView(reveal).session.canRequestHelp).toBe(false);
  });

  it.each(["reflectionAsked", "reflectionAnswered"] as const)("ignores stale %s outside the final phase but blocks final reflection", async (flag) => {
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(answerResult());
    const started = await start();
    const answered = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "A preliminary observation.");
    answered.session.state[flag] = true;
    expect(canRequestHelp(answered)).toBe(false);
    answered.case.phases.push({ ...answered.case.phases[0], id: crypto.randomUUID(), order: 2 });
    expect(canRequestHelp(answered)).toBe(true);
  });

  it("throws retryable and saves nothing when level-1 support is unavailable", async () => {
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(answerResult());
    vi.spyOn(support, "generateTutorSupport").mockResolvedValue(null);
    const started = await start();
    const answered = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The finding is relevant.", "answer-help-02");
    const version = answered.session.state.version;
    await expect(submitTutorHelp(answered.session.id, DEMO_STUDENT_ID, "help-fail-01")).rejects.toBeInstanceOf(HelpGenerationRetryableError);
    const reloaded = await repository.getSession(answered.session.id);
    expect(reloaded?.session.state.version).toBe(version);
    expect(reloaded?.session.messages).toHaveLength(answered.session.messages.length);
    expect(reloaded?.session.evaluations).toHaveLength(answered.session.evaluations.length);
  });

  it("treats a real answer containing the marker words as an ordinary graded answer", async () => {
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(answerResult());
    const started = await start();
    const answered = await submitStudentAnswer(
      started.session.id,
      DEMO_STUDENT_ID,
      HELP_REQUEST_MARKER,
      "answer-literal-marker",
    );
    const studentMessage = answered.session.messages.at(-2);
    expect(studentMessage).toMatchObject({
      content: HELP_REQUEST_MARKER,
      sender: "student",
      turnKind: "answer",
      helpRequested: false,
    });
    expect(answered.session.evaluations).toHaveLength(1);
    expect(studentView(answered).session.canRequestHelp).toBe(true);
  });
});
