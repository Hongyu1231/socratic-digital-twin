import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClinicalCase, TutorEvaluationResult } from "@/lib/domain";
import { DEMO_STUDENT_ID } from "@/lib/seed";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { resetRepositoryForTests } from "@/lib/repository";
import * as tutor from "@/lib/tutor";
import { submitStudentAnswer } from "@/lib/tutor/state-machine";
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

  async function start(phaseCount = 2, phaseCeiling = 8, tutorMoves: ClinicalCase["phases"][number]["tutorMoves"] = []) {
    const clinicalCase: ClinicalCase = {
      id: "", title: "Synthetic progression case", description: "A synthetic case for engine testing only.",
      difficulty: "foundation", status: "draft", learningObjectives: ["Reason using supplied evidence"],
      phases: Array.from({ length: phaseCount }, (_, index) => ({
        id: crypto.randomUUID(), caseId: "", order: index + 1, title: `Phase ${index + 1}`,
        goal: "Distinguish observations from assumptions.",
        rubric: [{ id: "private-observation", text: "Identify the supplied finding", revealText: "Separate what is observed from an assumed cause." },
          { id: "private-evidence", text: "Justify the observation using a record" }],
        starterQuestion: "Which finding or uncertainty had the greatest influence on your reasoning?",
        exampleQuestions: ["Which record supports that observation?"], phaseCeiling, tutorMoves,
      })),
      attachments: [{ id: crypto.randomUUID(), kind: "image", title: "Later image", description: "LOCKED_DESCRIPTION", url: "/later.svg", unlockPhase: 2 }],
      findings: [{ id: "later-finding", title: "Later examination", text: "LOCKED_FINDING", unlockPhase: 2 }],
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
    expect(bundle.session.messages.at(-1)?.content).toContain("with support");
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
});
