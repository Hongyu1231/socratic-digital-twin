import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClinicalCase, TutorEvaluationResult } from "@/lib/domain";
import { DEMO_ADMIN_ID, DEMO_STUDENT_ID } from "@/lib/seed";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { resetRepositoryForTests } from "@/lib/repository";
import * as tutor from "@/lib/tutor";
import { submitStudentAnswer } from "@/lib/tutor/state-machine";

const phaseOneCriteria = [
  {
    id: "p1-record-observation",
    text: "Names one observable finding and its tooth or region from the supplied record.",
    revealText: "State one observable finding and identify its tooth or region; do not infer a cause the record does not establish.",
  },
  {
    id: "p1-history-exam-context",
    text: "Identifies relevant history or examination information needed to interpret the supplied record and explains why it matters to the initial assessment.",
    revealText: "Name a relevant history or examination detail and explain why it matters to the initial assessment; do not infer a cause the record does not establish.",
  },
] as const;

const phaseOne = (caseId: string): ClinicalCase["phases"][number] => ({
  id: crypto.randomUUID(),
  caseId,
  order: 1,
  title: "Record and initial assessment",
  goal: "Describe what the supplied record establishes, then identify relevant history or examination information needed for an initial assessment.",
  rubric: [...phaseOneCriteria],
  starterQuestion: "What relevant history or clinical-examination information would you gather before interpreting the record?",
  exampleQuestions: [
    "Which supplied record supports the observation?",
    "Which history or examination detail would change your initial assessment, and why?",
  ],
  tutorGuidance: [
    "Keep observations, interpretations and causes separate; a recorded finding is not automatically causal.",
  ],
  tutorMoves: [],
});

const makeResult = (overrides: Partial<TutorEvaluationResult> = {}): TutorEvaluationResult => ({
  classification: "partial",
  confidence: 0.78,
  reasoningGap: "The relevant history or examination context is still missing.",
  misconceptionKey: null,
  strategy: "probe",
  feedback: "Keep the record observation separate from the information still needed for the initial assessment.",
  nextQuestion: "Which supplied record supports the observation?",
  acknowledgement: "You separated an observation from a possible explanation.",
  criteriaMet: [],
  targetCriterionId: "p1-history-exam-context",
  memoryPatch: { addErrors: [], addStrengths: [], addWeaknesses: [], masteryDelta: 0 },
  source: "deterministic",
  ...overrides,
});

describe("Case 1 draft feedback sequence", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the Jessica sequence relevant, reveals a bounded review point, and accepts application", async () => {
    const repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
    // The memory repository assigns a fresh ID when saving a new draft.  Keep
    // phase caseIds blank here so saveCase can rewrite them to that ID.
    const caseId = "";
    const clinicalCase: ClinicalCase = {
      id: caseId,
      title: "Synthetic canine record review",
      description: "A synthetic teaching case with a supplied record and a presenting concern.",
      difficulty: "advanced",
      status: "draft",
      learningObjectives: ["Separate record observations from causal claims."],
      phases: [
        phaseOne(caseId),
        {
          id: crypto.randomUUID(),
          caseId,
          order: 2,
          title: "Next assessment step",
          goal: "Choose the next evidence-gathering step.",
          rubric: [{ id: "p2-next-step", text: "Names an evidence-gathering next step." }],
          starterQuestion: "Which evidence-gathering step would you take next?",
          exampleQuestions: ["What uncertainty would that step resolve?"],
          tutorMoves: [],
        },
        {
          id: crypto.randomUUID(),
          caseId,
          order: 3,
          title: "Reflect on the next decision",
          goal: "State what you would revisit after gathering the missing evidence.",
          rubric: [{ id: "p3-reflection", text: "Names an uncertainty to revisit." }],
          starterQuestion: "What would you revisit next?",
          exampleQuestions: ["Which uncertainty remains most important?"],
          tutorMoves: [],
        },
      ],
      attachments: [],
      findings: [],
      sourceCaseId: null,
      version: 1,
      publishedAt: null,
    };
    const saved = await repository.saveCase(clinicalCase, DEMO_ADMIN_ID);
    await repository.publishCase(saved.id);

    const results = [
      makeResult({
        criteriaMet: [{
          id: "p1-record-observation",
          evidence: "The unerupted canine is a recorded observation; the record does not by itself establish its cause.",
        }],
        nextQuestion: "Which history or examination detail would change your initial assessment, and why?",
      }),
      makeResult({
        criteriaMet: [{
          id: "p1-history-exam-context",
          evidence: "I would ask about eruption history, symptoms and relevant examination findings because they change the initial assessment.",
        }],
      }),
      makeResult(),
      makeResult(),
      makeResult(),
      makeResult(),
      makeResult({ nextQuestion: "What evidence would you use to apply that point?" }),
      makeResult({ nextQuestion: "What evidence would you use to apply that point?" }),
    ];
    let evaluationIndex = 0;
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback").mockImplementation(async () => results[evaluationIndex++]);
    let bundle = await repository.createSession(DEMO_STUDENT_ID, saved.id);

    const answers = [
      "There is a tooth-size arch-width discrepancy; the unerupted canine is a recorded observation, not a conclusion about its cause.",
      "I would ask about eruption history, symptoms and relevant examination findings because they change the initial assessment.",
      "The next evidence-gathering step would be to document the relevant clinical examination.",
      "I still need to know which uncertainty that step should resolve.",
      "I would check the supplied record before making a management assumption.",
      "Please clarify what evidence is needed to apply this point.",
      "I would use the available record and state what remains uncertain.",
      "I would apply the review point by stating the evidence and the remaining uncertainty.",
    ];
    for (const answer of answers) {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    }

    expect(evaluate).toHaveBeenCalledTimes(8);
    expect(bundle.session.currentPhase).toBe(3);
    expect(bundle.session.state.phaseProgress?.["1"]).toMatchObject({
      criteriaMet: ["p1-record-observation", "p1-history-exam-context"],
      awaitingApplication: false,
      completedWithSupport: false,
      completed: true,
    });
    expect(bundle.session.state.phaseProgress?.["2"]).toMatchObject({
      criteriaMet: [],
      awaitingApplication: false,
      completedWithSupport: true,
      completed: true,
    });
    expect(bundle.session.evaluations[0].criteriaMet).toEqual([{
      id: "p1-record-observation",
      evidence: "The unerupted canine is a recorded observation; the record does not by itself establish its cause.",
    }]);
    const phaseOneTutorMessages = bundle.session.messages
      .filter((message) => message.sender === "ai")
      .map((message) => message.content);
    expect(phaseOneTutorMessages.join(" ")).not.toContain("relationship of #23 to #22");
    expect(phaseOneTutorMessages.join(" ")).not.toContain("relate to the presenting concern");
    expect(phaseOneTutorMessages.join(" ")).toContain("history or examination detail");
    expect(bundle.session.messages.at(-1)?.moveType).toBe("transition");
    expect(bundle.session.messages.at(-1)?.content).toContain("What would you revisit next?");
  });
});
