import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalCase, TutorEvaluationResult } from "@/lib/domain";
import { DEMO_STUDENT_ID } from "@/lib/seed";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { resetRepositoryForTests } from "@/lib/repository";
import * as tutor from "@/lib/tutor";
import * as support from "@/lib/tutor/support";
import { askedTutorQuestions, submitStudentAnswer } from "@/lib/tutor/state-machine";
import { studentCaseView, studentView } from "@/lib/http";

const result = (patch: Partial<TutorEvaluationResult> = {}): TutorEvaluationResult => ({
  classification: "partial", confidence: 0.8, reasoningGap: "Needs supporting evidence.",
  misconceptionKey: null, strategy: "probe", feedback: "One link remains unclear.",
  acknowledgement: "You distinguished an observation from its possible cause.",
  nextQuestion: "What is the relationship to the presenting concern?",
  criteriaMet: [], targetCriterionId: "private-observation", source: "deterministic",
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: ["Needs to justify the observation."], masteryDelta: 0 },
  ...patch,
});

describe("v2 end-to-end tutor state", () => {
  let repository: InMemoryTutorRepository;
  beforeEach(() => { repository = new InMemoryTutorRepository(); repository.reset(); resetRepositoryForTests(repository); });
  afterEach(() => vi.restoreAllMocks());

  async function start(phaseCount = 2, phaseCeiling = 8, tutorMoves: ClinicalCase["phases"][number]["tutorMoves"] = [], acceptedExtras: ClinicalCase["phases"][number]["acceptedExtras"] = []) {
    const clinicalCase: ClinicalCase = {
      id: "", title: "Synthetic progression case", description: "A synthetic case for engine testing only.",
      difficulty: "foundation", status: "draft", learningObjectives: ["Reason using supplied evidence"],
      phases: Array.from({ length: phaseCount }, (_, index) => ({
        id: crypto.randomUUID(), caseId: "", order: index + 1, title: `Phase ${index + 1}`,
        goal: "Distinguish observations from assumptions.",
        rubric: [{ id: "private-observation", text: "Identify the supplied finding", revealText: "Separate what is observed from an assumed cause." },
          { id: "private-evidence", text: "Justify the observation using a record" }],
        starterQuestion: index === 0 ? "Which finding or uncertainty had the greatest influence on your reasoning?" : "How would you assess the next finding?",
        exampleQuestions: ["Which record supports that observation?"], phaseCeiling, tutorMoves, acceptedExtras,
      })),
      // Keep phase-unlock fixtures valid for one-phase reflection tests too;
      // a phase-2 item cannot exist in a one-phase case under the integrity
      // contract.
      attachments: phaseCount > 1
        ? [{ id: crypto.randomUUID(), kind: "image", title: "Later image", description: "LOCKED_DESCRIPTION", url: "/later.svg", unlockPhase: 2 }]
        : [],
      findings: phaseCount > 1
        ? [{ id: "later-finding", title: "Later examination", text: "LOCKED_FINDING", unlockPhase: 2 }]
        : [],
    };
    const saved = await repository.saveCase(clinicalCase, "99999999-9999-4999-8999-999999999999");
    await repository.publishCase(saved.id);
    return repository.createSession(DEMO_STUDENT_ID, saved.id);
  }

  it("requires all explicit criteria and retains acknowledgement on transition", async () => {
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback")
      .mockResolvedValueOnce(result({ classification: "correct", criteriaMet: ["private-observation"] }))
      .mockResolvedValueOnce(result({ classification: "correct", criteriaMet: ["private-evidence"] }));
    const started = await start();
    const partial = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "First supported observation.");
    expect(partial.session.currentPhase).toBe(1);
    expect(studentView(partial).case.phases[0].phaseProgress?.criteriaMet).toBe(1);
    const complete = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "Here is the remaining supporting evidence.");
    expect(complete.session.currentPhase).toBe(2);
    expect(complete.session.messages.at(-1)?.acknowledgement).toBe(result().acknowledgement);
    expect(complete.session.messages.at(-1)?.content).toContain(result().acknowledgement);
    expect(complete.session.messages.at(-1)?.moveType).toBe("transition");
    expect(JSON.stringify(evaluate.mock.calls[0][0].caseContext)).not.toContain("LOCKED_");
    expect(JSON.stringify(studentView(partial))).not.toContain("private-observation");
    expect(studentCaseView(started.case).attachments).toEqual([]);
  });

  it("records optional observations without delaying support, and completes on required evidence alone", async () => {
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback")
      .mockResolvedValueOnce(result({ classification: "correct", answerCriterionId: "bonus-parallax", targetCriterionId: "bonus-parallax", criteriaMet: ["bonus-parallax"] }))
      .mockResolvedValueOnce(result({ classification: "correct", answerCriterionId: null, criteriaMet: [] }))
      .mockResolvedValueOnce(result({ classification: "partial", answerCriterionId: "private-observation", criteriaMet: ["private-observation", "private-evidence"] }));
    const started = await start(2, 5, [], [{ id: "bonus-parallax", text: "PRIVATE_BONUS_TEXT" }]);
    const first = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "Parallax is an optional technique.");
    expect(first.session.currentPhase).toBe(1);
    expect(first.session.state.phaseProgress?.["1"]).toMatchObject({ criteriaMet: [], bestClassification: "wrong", noProgressCount: 1 });
    const second = await submitStudentAnswer(first.session.id, DEMO_STUDENT_ID, "I can also discuss third molars.");
    expect(second.session.state.phaseProgress?.["1"]).toMatchObject({ supportLevel: 1, criteriaMet: [] });
    const complete = await submitStudentAnswer(second.session.id, DEMO_STUDENT_ID, "Here is the required observation and its evidence.");
    expect(complete.session.currentPhase).toBe(2);
    expect(complete.session.evaluations.at(-1)?.answerCriterionId).toBe("private-observation");
    const publicResponse = JSON.stringify(studentView(complete));
    expect(publicResponse).not.toContain("PRIVATE_BONUS_TEXT");
    expect(publicResponse).not.toContain("answerCriterionId");
    expect(publicResponse).not.toContain("acceptedExtras");
    expect(evaluate.mock.calls[0][0].phase.acceptedExtras).toHaveLength(1);
  });

  it("bounds Jessica-style repeated partial answers and preserves unresolved gaps", async () => {
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result());
    let bundle = await start();
    const answers = [
      "There is tooth-size arch-width discrepancy, but the unerupted canine does not directly cause visible crowding.",
      "I am not sure what relationship you want me to describe.",
      "The depth of impaction.",
      "I still do not understand the same question.",
      "Please clarify what evidence is needed.",
    ];
    for (const answer of answers) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.currentPhase).toBe(1);
    expect(bundle.session.state.phaseProgress?.["1"].awaitingApplication).toBe(true);
    expect(bundle.session.messages.at(-1)?.moveType).toBe("reveal");
    bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, "I still cannot fully apply that point.");
    expect(bundle.session.currentPhase).toBe(2);
    expect(bundle.session.evaluations.at(-1)).toMatchObject({ classification: "partial", completedWithSupport: true });
    expect(bundle.session.state.phaseEvidence?.["1"].completed).toBe(false);
    expect(bundle.session.state.weaknesses.length).toBeGreaterThan(0);
    expect(bundle.session.messages.at(-1)?.content).toContain(result().acknowledgement);
    expect(bundle.session.messages.at(-1)?.content).not.toContain("with support");
  });

  it("always asks an explicit final reflection and does not grade its answer", async () => {
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result({
      classification: "correct", criteriaMet: ["private-observation", "private-evidence"],
    }));
    const started = await start(1);
    const reflection = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The criteria are supported by these records.");
    expect(reflection.session.status).toBe("active");
    expect(reflection.session.state.reflectionAsked).toBe(true);
    expect(reflection.session.messages.at(-1)?.moveType).toBe("reflection");
    const complete = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "I am still unsure what I would change.", "final-reflection-001");
    expect(complete.session.status).toBe("completed");
    expect(complete.session.score).toBe(100);
    expect(complete.session.messages.at(-1)?.content).toBe("You have completed all 1 phase. Your learning summary is ready.");
    expect(complete.session.evaluations.at(-1)?.isReflection).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    const replay = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "I am still unsure what I would change.", "final-reflection-001");
    expect(replay.session.messages).toEqual(complete.session.messages);
    expect(evaluate).toHaveBeenCalledTimes(1);
    await expect(submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "A different payload.", "final-reflection-001")).rejects.toThrow(/different content/i);
  });

  it("ceiling reveal waits for application, then reflection, and summary records support", async () => {
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result());
    let bundle = await start(1, 2);
    for (const answer of ["I need help.", "I still need help."]) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.state.reflectionAsked).toBe(false);
    expect(bundle.session.messages.at(-1)?.moveType).toBe("reveal");
    bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, "I have tried applying the hint.");
    expect(bundle.session.state.reflectionAsked).toBe(true);
    expect(bundle.session.status).toBe("active");
    bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, "I would revisit the supporting evidence.");
    expect(bundle.session.status).toBe("completed");
    expect(bundle.session.summary).toMatchObject({ supportedPhases: [1], overallScore: 70, completedAllPhases: true });
    expect(bundle.session.summary?.narrative).toContain("not demonstrated independent mastery");
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("replays after pausing without model calls and rejects another learner", async () => {
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result());
    const started = await start();
    await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "A first answer.", "paused-retry-001");
    await repository.setSessionPaused(started.session.id, new Date().toISOString());
    const replay = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "A first answer.", "paused-retry-001");
    expect(replay.session.pausedAt).toBeTruthy();
    expect(evaluate).toHaveBeenCalledTimes(1);
    await expect(submitStudentAnswer(started.session.id, crypto.randomUUID(), "A first answer.", "paused-retry-001")).rejects.toThrow(/belongs/);
  });

  it("does not repeat an identical question hidden behind an acknowledgement", async () => {
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result());
    const started = await start();
    await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "One observation.");
    const repeated = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "I still do not understand the question.");
    expect(repeated.session.messages.at(-1)?.content).not.toContain(result().nextQuestion);
    expect(repeated.session.messages.at(-1)?.content).toContain("Which record supports that observation?");
    expect(repeated.session.evaluations.at(-1)?.targetCriterionId).toBeUndefined();
  });

  it("guards repeated scripted questions and hides private move IDs", async () => {
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result());
    const started = await start(2, 8, [{
      id: "private-blocking-move", strategy: "probe", question: "Which precise observation supports that conclusion?",
      blockAdvancement: true, recordError: "The basis remains unclear.", targetCriterionId: "private-observation",
    }]);
    await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "A claim without evidence.");
    const repeated = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "Still the same claim.");
    expect(repeated.session.messages.at(-1)?.content).not.toContain("Which precise observation supports that conclusion?");
    expect(JSON.stringify(studentView(repeated))).not.toContain("private-blocking-move");
  });

  it("writes step-up wording in a second call that carries the new level and target criterion", async () => {
    vi.spyOn(tutor, "getTutorMode").mockReturnValue("openai");
    let turn = 0;
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback").mockImplementation(async () =>
      result({ source: "openai", nextQuestion: `Ordinary question ${++turn}?` }));
    const generate = vi.spyOn(support, "generateTutorSupport").mockImplementation(async (input) => ({
      source: "openai",
      content: `Model wording for level ${input.support.level}, would that hold up?`,
    }));
    let bundle = await start();
    for (const answer of ["First try.", "Second try.", "Third try.", "Fourth try.", "Fifth try."]) {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    }
    const supportCalls = generate.mock.calls.map(([input]) => input);
    expect(supportCalls.map((input) => input.support)).toEqual([
      { level: 1, targetCriterion: expect.objectContaining({ id: "private-observation" }) },
      { level: 2, targetCriterion: expect.objectContaining({ id: "private-observation", revealText: "Separate what is observed from an assumed cause." }) },
    ]);
    expect(supportCalls.map((input) => input.state.phaseProgress?.["1"].supportLevel)).toEqual([1, 2]);
    expect(evaluate).toHaveBeenCalledTimes(5);
    const tutorMessages = bundle.session.messages.filter((message) => message.sender === "ai");
    expect(tutorMessages.filter((message) => message.moveType === "hypothetical").map((message) => message.content))
      .toEqual([expect.stringContaining("Model wording for level 1, would that hold up?")]);
    expect(tutorMessages.at(-1)).toMatchObject({ moveType: "reveal", content: expect.stringContaining("Model wording for level 2, would that hold up?") });
    expect(bundle.session.evaluations.at(-1)?.targetCriterionId).toBe("private-observation");
    for (const message of tutorMessages) {
      expect(message.content).not.toContain("Suppose a colleague");
      expect(message.content).not.toContain("Review point:");
      expect(message.content).not.toContain("Distinguish observations from assumptions");
    }
  });

  it("uses the fixed plain text when the step-up call fails, with no goal text", async () => {
    vi.spyOn(tutor, "getTutorMode").mockReturnValue("openai");
    let turn = 0;
    vi.spyOn(tutor, "evaluateWithFallback").mockImplementation(async (input) => {
      if (input.support?.level === 1) throw new Error("provider unavailable");
      if (input.support) return { ...result({ nextQuestion: "A deterministic stand-in?" }), fallbackFrom: "openai" as const };
      return result({ source: "openai", acknowledgement: undefined, nextQuestion: `Ordinary question ${++turn}?` });
    });
    let bundle = await start();
    for (const answer of ["First try.", "Second try.", "Third try."]) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.messages.at(-1)).toMatchObject({ moveType: "hypothetical", content: "One possible plan is to act before checking the available records. What might that plan miss?", supportProvider: "deterministic", supportFallbackFrom: "openai" });
    expect(bundle.session.evaluations.at(-1)?.targetCriterionId).toBeUndefined();
    for (const answer of ["Fourth try.", "Fifth try."]) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.messages.at(-1)).toMatchObject({
      moveType: "reveal", content: "Separate what is observed from an assumed cause. How would you use this in your plan?",
    });
    for (const message of bundle.session.messages.filter((item) => item.sender === "ai")) {
      expect(message.content).not.toContain("Suppose a colleague");
      expect(message.content).not.toMatch(/^Review point:/);
      expect(message.content).not.toContain("Distinguish observations from assumptions");
    }
  });

  it("asks the final phase's reflect move as the closing question, never mid-phase", async () => {
    const closing = "Looking back over the whole case, which prognostic factor had the biggest impact on the management of the impacted maxillary canine, and why?";
    vi.spyOn(tutor, "evaluateWithFallback")
      .mockResolvedValueOnce(result({ classification: "correct" }))
      .mockResolvedValueOnce(result({ criteriaMet: ["private-observation", "private-evidence"] }));
    const started = await start(1, 8, [{ id: "private-closing", strategy: "reflect", question: closing }]);
    const first = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "A correct but incomplete answer.");
    expect(first.session.messages.at(-1)?.content).not.toContain(closing);
    expect(first.session.state.usedTutorMoves).toEqual([]);
    const second = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The remaining evidence.");
    expect(second.session.messages.at(-1)).toMatchObject({ moveType: "reflection", content: `${result().acknowledgement} ${closing}` });
  });

  async function finishPhaseWithSupport(lastAcknowledgement: string | undefined) {
    vi.spyOn(tutor, "evaluateWithFallback")
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result({ acknowledgement: lastAcknowledgement }));
    let bundle = await start(2, 2);
    for (const answer of ["I need help.", "I still need help.", "I tried to use the hint."]) {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    }
    expect(bundle.session.currentPhase).toBe(2);
    expect(bundle.session.evaluations.at(-1)).toMatchObject({ completedWithSupport: true, supportLevel: 2 });
    expect(studentView(bundle).case.phases[0].phaseProgress?.completedWithSupport).toBe(true);
    return bundle.session.messages.at(-1)!;
  }

  it("keeps the model's acknowledgement when a phase ends with support", async () => {
    const message = await finishPhaseWithSupport("You tried the hint on the supplied record.");
    expect(message.acknowledgement).toBe("You tried the hint on the supplied record.");
    expect(message.content).toBe("You tried the hint on the supplied record. How would you assess the next finding?");
    expect(message.completedWithSupport).toBe(true);
    expect(message.content).not.toContain("with support");
  });

  it.each([
    undefined,
    "",
    "Can you say more?",
    "You've got it now.",
    "Well done, that is correct.",
    "You have mastered this part.",
  ])("uses the exact fixed line when the supported acknowledgement is unusable: %s", async (acknowledgement) => {
    const message = await finishPhaseWithSupport(acknowledgement);
    expect(message.acknowledgement).toBe("Let's move on to the next part.");
    expect(message.content).toBe("Let's move on to the next part. How would you assess the next finding?");
    expect(message.content).not.toMatch(/got it|well done|correct|master/i);
  });

  it("drops an acknowledgement longer than 20 words before a step-up", async () => {
    vi.spyOn(tutor, "getTutorMode").mockReturnValue("openai");
    const long = `${Array.from({ length: 21 }, (_, index) => `word${index}`).join(" ")}.`;
    vi.spyOn(tutor, "evaluateWithFallback")
      .mockResolvedValueOnce(result({ source: "openai", nextQuestion: "Ordinary question 1?" }))
      .mockResolvedValueOnce(result({ source: "openai", nextQuestion: "Ordinary question 2?" }))
      .mockResolvedValueOnce(result({ source: "openai", acknowledgement: long }))
      .mockResolvedValueOnce(result({ source: "openai", nextQuestion: "Ordinary question 4?" }))
      .mockResolvedValueOnce(result({ source: "openai", acknowledgement: "You named one finding." }));
    vi.spyOn(support, "generateTutorSupport").mockImplementation(async (input) => ({
      source: "openai", content: input.support.level === 1 ? "A plan for level 1. What might it miss?" : "A finding for level 2. How would this change your plan?",
    }));
    let bundle = await start();
    for (const answer of ["First try.", "Second try.", "Third try."]) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.messages.at(-1)).toMatchObject({ moveType: "hypothetical", content: "A plan for level 1. What might it miss?" });
    expect(bundle.session.messages.at(-1)?.acknowledgement).toBeUndefined();
    for (const answer of ["Fourth try.", "Fifth try."]) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.messages.at(-1)).toMatchObject({
      moveType: "reveal", acknowledgement: "You named one finding.",
      content: "You named one finding. A finding for level 2. How would this change your plan?",
    });
  });

  it("passes every earlier tutor question, from all phases and without duplicates, to both prompts", async () => {
    vi.spyOn(tutor, "getTutorMode").mockReturnValue("openai");
    let turn = 0;
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback")
      .mockResolvedValueOnce(result({ source: "openai", classification: "correct", criteriaMet: ["private-observation", "private-evidence"] }))
      .mockImplementation(async () => result({ source: "openai", nextQuestion: `Phase two question ${++turn}?` }));
    const generate = vi.spyOn(support, "generateTutorSupport").mockResolvedValue({ source: "openai", content: "One plan is to wait. What might it miss?" });
    const starter = "Which finding or uncertainty had the greatest influence on your reasoning?";
    let bundle = await start();
    bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, "Both required points.");
    expect(bundle.session.currentPhase).toBe(2);
    for (const answer of ["First try.", "Second try.", "Third try."]) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    const history = [starter, "How would you assess the next finding?", "Phase two question 1?", "Phase two question 2?"];
    expect(evaluate.mock.calls.at(-1)?.[0].askedQuestions).toEqual(history);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].askedQuestions).toEqual(history);
    expect(askedTutorQuestions(bundle.session.messages)).toEqual([...history, "What might it miss?"]);
    for (const question of askedTutorQuestions(bundle.session.messages)) expect(question).not.toContain(result().acknowledgement);
  });

  it("ignores a stale reflection flag outside the final phase", async () => {
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result());
    const started = await start();
    vi.spyOn(repository, "getSession").mockResolvedValueOnce({
      ...started, session: { ...started.session, state: { ...started.session.state, reflectionAsked: true } },
    });
    const updated = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "An ordinary first-phase answer.");
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(updated.session.status).toBe("active");
    expect(updated.session.summary).toBeNull();
    expect(updated.session.evaluations.at(-1)?.isReflection).toBe(false);
    expect(updated.session.state.reflectionAsked).toBe(false);
  });

  it("does not repeat a next-phase starter already asked in the first phase", async () => {
    const started = await start();
    const firstQuestion = started.case.phases[0].starterQuestion;
    vi.spyOn(repository, "getSession").mockResolvedValueOnce({ ...started,
      case: { ...started.case, phases: started.case.phases.map(phase => ({ ...phase, starterQuestion: firstQuestion })) } });
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result({ classification: "correct", criteriaMet: ["private-observation", "private-evidence"] }));
    const advanced = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "Both required points.");
    expect(advanced.session.currentPhase).toBe(2);
    expect(advanced.session.messages.at(-1)?.content).not.toContain(firstQuestion);
    expect(advanced.session.messages.at(-1)?.content).toContain("Which record supports that observation?");
  });

  it("persists the actual automatic-support generator independently of grading", async () => {
    const started = await start(2, 1);
    vi.spyOn(tutor, "getTutorMode").mockReturnValue("openai");
    vi.spyOn(tutor, "evaluateWithFallback").mockResolvedValue(result({ source: "deterministic", fallbackFrom: "openai" }));
    vi.spyOn(support, "generateTutorSupport").mockResolvedValue({ source: "openai", content: "The supplied finding needs a supporting record. How would you use this in your plan?" });
    const updated = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "One weak answer.");
    expect(updated.session.evaluations.at(-1)?.provider).toBe("deterministic");
    expect(updated.session.messages.at(-1)?.supportProvider).toBe("openai");
    expect(updated.runtime.tutor).toBe("openai");
    expect((await repository.getSession(updated.session.id))?.runtime.tutor).toBe("openai");
  });
});
