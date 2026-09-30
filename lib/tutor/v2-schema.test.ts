import { describe, expect, it } from "vitest";

import { zodTextFormat } from "openai/helpers/zod";

import type { CasePhase, TutorEvaluationResult } from "@/lib/domain";
import {
  caseInputSchema,
  phaseInputSchema,
  tutorOutputSchema,
  tutorProviderOutputSchema,
} from "@/lib/schemas";
import { normalizeCriterionTags } from "@/lib/tutor/criteria";

const phaseInput = (overrides: Record<string, unknown> = {}) => ({
  order: 1,
  title: "Observe the record",
  goal: "Describe a specific finding and its supporting evidence.",
  rubric: [{ id: "observation", text: "States a specific observation", revealText: "State the visible observation." }],
  starterQuestion: "What do you notice in the supplied record?",
  exampleQuestions: ["Which record supports that observation?"],
  tutorGuidance: [],
  tutorMoves: [],
  ...overrides,
});

const caseInput = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Schema test case",
  description: "A synthetic case for schema validation tests.",
  difficulty: "intermediate" as const,
  learningObjectives: ["Use the supplied evidence."],
  attachments: [],
  findings: [],
  phases: [phaseInput()],
  ...overrides,
});

const twoPhaseCase = (overrides: Record<string, unknown> = {}) => caseInput({
  phases: [
    phaseInput({ id: "22222222-2222-4222-8222-222222222222", order: 1 }),
    phaseInput({ id: "33333333-3333-4333-8333-333333333333", order: 2 }),
  ],
  ...overrides,
});

const providerOutput = (overrides: Record<string, unknown> = {}) => ({
  acknowledgement: null,
  targetCriterionId: null,
  criteriaMet: [],
  classification: "partial" as const,
  confidence: 0.8,
  reasoningGap: "The answer needs a clearer evidence link.",
  misconceptionKey: null,
  strategy: "probe" as const,
  feedback: "Name the evidence that supports the observation.",
  nextQuestion: "Which supplied record supports that observation?",
  memoryPatch: {
    addErrors: [],
    addStrengths: [],
    addWeaknesses: ["Needs an explicit evidence link"],
    masteryDelta: 0,
  },
  ...overrides,
});

const evaluationResult = (overrides: Partial<TutorEvaluationResult> = {}): TutorEvaluationResult => ({
  ...providerOutput(),
  acknowledgement: undefined,
  targetCriterionId: null,
  criteriaMet: [],
  source: "openai",
  ...overrides,
}) as TutorEvaluationResult;

const phase = (): CasePhase => ({
  id: "phase-1",
  caseId: "case-1",
  order: 1,
  title: "Observe",
  goal: "Describe the supplied evidence.",
  rubric: [{ id: "observation", text: "States a specific observation" }],
  starterQuestion: "What do you notice?",
  exampleQuestions: ["Which record supports that?"],
});

describe("tutor engine v2 schemas", () => {
  it("rejects a reordered payload rather than silently changing phase unlock semantics", () => {
    expect(caseInputSchema.safeParse(caseInput({ phases: [phaseInput({ order: 2 }), phaseInput({ order: 1 })] })).success).toBe(false);
  });

  it("accepts explicit and legacy rubric forms", () => {
    expect(phaseInputSchema.safeParse(phaseInput()).success).toBe(true);
    expect(phaseInputSchema.safeParse(phaseInput({ rubric: ["legacy observation"] })).success).toBe(true);
  });

  it("rejects duplicate explicit IDs and collisions with legacy compatibility IDs", () => {
    expect(phaseInputSchema.safeParse(phaseInput({ rubric: [
      { id: "duplicate", text: "First" },
      { id: "duplicate", text: "Second" },
    ] })).success).toBe(false);
    expect(phaseInputSchema.safeParse(phaseInput({ rubric: [
      "Legacy first",
      { id: "r1", text: "Explicit second" },
    ] })).success).toBe(false);
  });

  it("validates scripted criterion tags against the phase rubric", () => {
    expect(phaseInputSchema.safeParse(phaseInput({ tutorMoves: [{
      id: "probe-observation",
      strategy: "probe",
      question: "Which record supports that observation?",
      targetCriterionId: "observation",
    }] })).success).toBe(true);
    expect(phaseInputSchema.safeParse(phaseInput({ tutorMoves: [{
      id: "probe-unknown",
      strategy: "probe",
      question: "Which record supports that observation?",
      targetCriterionId: "unknown",
    }] })).success).toBe(false);
  });

  it("bounds the no-progress and phase-ceiling controls", () => {
    expect(phaseInputSchema.safeParse(phaseInput({ noProgressLimit: 1, phaseCeiling: 2 })).success).toBe(true);
    expect(phaseInputSchema.safeParse(phaseInput({ noProgressLimit: 4, phaseCeiling: 12 })).success).toBe(true);
    expect(phaseInputSchema.safeParse(phaseInput({ noProgressLimit: 0 })).success).toBe(false);
    expect(phaseInputSchema.safeParse(phaseInput({ noProgressLimit: 5 })).success).toBe(false);
    expect(phaseInputSchema.safeParse(phaseInput({ phaseCeiling: 1 })).success).toBe(false);
    expect(phaseInputSchema.safeParse(phaseInput({ phaseCeiling: 13 })).success).toBe(false);
  });

  it("requires unique contiguous phase IDs/orders and unlocks only existing phases", () => {
    expect(caseInputSchema.safeParse(twoPhaseCase({
      attachments: [{
        kind: "image",
        title: "Later OPG",
        description: "Unlocked during phase two.",
        storagePath: "cases/opg.webp",
        unlockPhase: 2,
      }],
    })).success).toBe(true);

    expect(caseInputSchema.safeParse(twoPhaseCase({
      phases: [
        phaseInput({ id: "22222222-2222-4222-8222-222222222222", order: 1 }),
        phaseInput({ id: "33333333-3333-4333-8333-333333333333", order: 1 }),
      ],
    })).success).toBe(false);
    expect(caseInputSchema.safeParse(twoPhaseCase({
      phases: [
        phaseInput({ id: "22222222-2222-4222-8222-222222222222", order: 1 }),
        phaseInput({ id: "22222222-2222-4222-8222-222222222222", order: 2 }),
      ],
    })).success).toBe(false);
    expect(caseInputSchema.safeParse(twoPhaseCase({
      phases: [
        phaseInput({ id: "22222222-2222-4222-8222-222222222222", order: 1 }),
        phaseInput({ id: "33333333-3333-4333-8333-333333333333", order: 3 }),
      ],
    })).success).toBe(false);
    expect(caseInputSchema.safeParse(twoPhaseCase({
      attachments: [{
        kind: "image",
        title: "Unavailable OPG",
        description: "References a phase outside this case.",
        storagePath: "cases/opg.webp",
        unlockPhase: 3,
      }],
    })).success).toBe(false);
  });

  it("accepts private storage paths with valid phase unlocks and rejects unsafe or impossible media", () => {
    const privateCase = caseInput({
      attachments: [{
        kind: "image",
        title: "OPG",
        description: "Published teaching image.",
        storagePath: "cases/11111111-1111-4111-8111-111111111111/opg.webp",
        unlockPhase: 1,
        unlockOnRequest: false,
      }],
    });
    expect(caseInputSchema.safeParse(privateCase).success).toBe(true);

    expect(caseInputSchema.safeParse(caseInput({
      attachments: [{
        kind: "image",
        title: "OPG",
        description: "Unsafe path.",
        storagePath: "cases/../secret.webp",
        unlockPhase: 1,
      }],
    })).success).toBe(false);
    expect(caseInputSchema.safeParse(caseInput({
      attachments: [{
        kind: "image",
        title: "OPG",
        description: "Unlocks after the case ends.",
        storagePath: "cases/opg.webp",
        unlockPhase: 2,
      }],
    })).success).toBe(false);
    expect(caseInputSchema.safeParse(caseInput({
      attachments: [{
        kind: "image",
        title: "OPG",
        description: "Cannot mix public and private media.",
        url: "/opg.webp",
        storagePath: "cases/opg.webp",
        unlockPhase: 1,
      }],
    })).success).toBe(false);
  });

  it("requires the provider's nullable acknowledgement/target and criteria array", () => {
    expect(tutorProviderOutputSchema.safeParse(providerOutput()).success).toBe(true);
    expect(tutorProviderOutputSchema.safeParse({ ...providerOutput(), acknowledgement: "Observed." }).success).toBe(true);
    expect(tutorProviderOutputSchema.safeParse({ ...providerOutput(), targetCriterionId: "observation" }).success).toBe(true);
    expect(tutorProviderOutputSchema.safeParse({
      ...providerOutput(),
      criteriaMet: [{ id: "observation", evidence: "The crown is between the adjacent roots." }],
    }).success).toBe(true);
    expect(tutorProviderOutputSchema.safeParse({ ...providerOutput(), criteriaMet: ["observation"] }).success).toBe(false);
    expect(tutorProviderOutputSchema.safeParse({ ...providerOutput(), acknowledgement: undefined }).success).toBe(false);
    expect(tutorProviderOutputSchema.safeParse({ ...providerOutput(), criteriaMet: undefined }).success).toBe(false);
  });

  it("serializes with the real OpenAI zodTextFormat helper", () => {
    const format = zodTextFormat(tutorProviderOutputSchema, "tutor_evaluation");
    expect(format).toMatchObject({ type: "json_schema", name: "tutor_evaluation", strict: true });
    expect(format.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining(["acknowledgement", "targetCriterionId", "criteriaMet"]),
    });
  });

  it("normalizes invalid semantic tags without changing the grade", () => {
    const result = normalizeCriterionTags(evaluationResult({
      classification: "wrong",
      confidence: 0.96,
      misconceptionKey: "unsupported-absolute-claim",
      targetCriterionId: "unknown",
      criteriaMet: [{ id: "unknown", evidence: "Discard this unknown tag." }, { id: "observation", evidence: "The answer names an observation." }],
      acknowledgement: "That claim is unsupported.",
    }), phase());

    expect(result.classification).toBe("wrong");
    expect(result.confidence).toBe(0.96);
    expect(result.misconceptionKey).toBe("unsupported-absolute-claim");
    expect(result.targetCriterionId).toBeNull();
    expect(result.criteriaMet).toEqual([{ id: "observation", evidence: "The answer names an observation." }]);
    expect(result.acknowledgement).toBe("That claim is unsupported.");

    const invalidAcknowledgement = normalizeCriterionTags(evaluationResult({
      classification: "correct",
      criteriaMet: ["observation"],
      targetCriterionId: "observation",
      acknowledgement: "Can you explain why?",
    }), phase());
    expect(invalidAcknowledgement.classification).toBe("correct");
    expect(invalidAcknowledgement.criteriaMet).toEqual(["observation"]);
    expect(invalidAcknowledgement.targetCriterionId).toBe("observation");
    expect(invalidAcknowledgement.acknowledgement).toBeUndefined();
  });

  it("keeps supported evidence, drops unknown IDs, and does not verify quote overlap", () => {
    const result = normalizeCriterionTags(evaluationResult({
      classification: "partial",
      criteriaMet: [
        { id: "observation", evidence: "A paraphrase that is not a literal answer substring." },
        { id: "unknown", evidence: "Should be ignored." },
      ],
    }), phase());

    expect(result.criteriaMet).toEqual([{
      id: "observation",
      evidence: "A paraphrase that is not a literal answer substring.",
    }]);
  });

  it("keeps the application schema permissive for legacy provider fields", () => {
    expect(tutorOutputSchema.safeParse({
      ...providerOutput(),
      acknowledgement: undefined,
      targetCriterionId: undefined,
      criteriaMet: undefined,
    }).success).toBe(true);
  });
});
