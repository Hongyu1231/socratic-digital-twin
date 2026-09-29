import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClinicalCase, SessionBundle } from "@/lib/domain";
import { studentView } from "@/lib/http";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { DEMO_STUDENT_ID, demoUsers } from "@/lib/seed";
import { getMaterialPack } from "@/lib/materials/pack";
import { getTeachingContext } from "@/lib/materials/retrieval";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const originalEnvironment = new Map(
  ["TUTOR_MATERIALS_DIR", "FORCE_MEMORY_REPOSITORY", "VERCEL"].map((name) => [name, process.env[name]]),
);

function manifest() {
  return {
    formatVersion: 1,
    packageId: "synthetic-materials-test-package",
    cases: [{
      case: {
        id: CASE_ID,
        title: "Synthetic materials case",
        description: "A synthetic case used to verify bounded teaching context.",
        difficulty: "intermediate",
        status: "available",
        learningObjectives: ["Use supplied evidence before choosing a plan."],
        attachments: [],
        phases: [{
          id: PHASE_ID,
          caseId: CASE_ID,
          order: 1,
          title: "Observe the record",
          goal: "Describe an observation before forming a conclusion.",
          rubric: ["specific observation", "supporting evidence"],
          starterQuestion: "Which observation would you investigate first?",
          exampleQuestions: ["Which supplied record supports that observation?"],
          tutorGuidance: [],
          tutorMoves: [],
        }],
      },
      expertNotes: "FACULTY_ONLY_SYNTHETIC_NOTE",
      sourceDocument: "synthetic-case.docx",
    }],
    articles: [{
      id: "synthetic-article-1",
      title: "Synthetic evidence article",
      filename: "synthetic-evidence.pdf",
      sha256: "a".repeat(64),
      pages: [
        { page: 1, text: "General background that should not outrank the case record." },
        { page: 2, text: "Synthetic canine localisation evidence supports checking the supplied record and stating the limitation of the projection." },
      ],
    }],
    media: [],
  };
}

async function createPackDirectory() {
  const root = await mkdtemp(path.join(os.tmpdir(), "socratic-materials-test-"));
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest()), "utf8");
  process.env.TUTOR_MATERIALS_DIR = root;
  process.env.FORCE_MEMORY_REPOSITORY = "true";
  delete process.env.VERCEL;
  return root;
}

function restoreEnvironment() {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function bundleWithHiddenFields(clinicalCase: ClinicalCase): SessionBundle {
  const caseWithHiddenFields = {
    ...clinicalCase,
    teachingMaterialPackageId: "f".repeat(64),
    phases: clinicalCase.phases.map((phase, index) => index === 0 ? {
      ...phase,
      tutorGuidance: ["PRIVATE_TUTOR_GUIDANCE"],
      tutorMoves: [{
        id: "private-move",
        strategy: "challenge",
        question: "PRIVATE_SCRIPTED_QUESTION?",
        recordError: "PRIVATE_RECORD_ERROR",
        blockAdvancement: true,
      }],
      rubric: ["PRIVATE_RUBRIC"],
      starterQuestion: "PRIVATE_STARTER_QUESTION?",
      exampleQuestions: ["PRIVATE_EXAMPLE_QUESTION?"],
      examinerNotes: "PRIVATE_EXAMINER_NOTES",
      answerKey: "PRIVATE_ANSWER_KEY",
    } : phase) as ClinicalCase["phases"],
    expertNotes: "FACULTY_ONLY_SYNTHETIC_NOTE",
    sourceDocument: "private-source.docx",
    literature: [{ sourceId: "private-article", title: "Private source", page: 1, text: "PRIVATE_SOURCE_TEXT" }],
  } as ClinicalCase;
  return {
    case: caseWithHiddenFields,
    student: demoUsers.find((user) => user.id === DEMO_STUDENT_ID)!,
    session: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      studentId: DEMO_STUDENT_ID,
      caseId: clinicalCase.id,
      currentPhase: 1,
      status: "active",
      reviewStatus: "pending",
      score: null,
      summary: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      assignmentId: null,
      reviewerId: null,
      messages: [],
      evaluations: [],
      state: {
        sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        currentGoal: "Describe an observation before forming a conclusion.",
        previousErrors: [],
        strengths: [],
        weaknesses: [],
        nextStrategy: "probe",
        phaseAttempts: { "1": 0 },
        mastery: { "1": 0 },
        usedTutorMoves: [],
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    answerReviews: [],
    tutorTurnReviews: [],
    sessionReview: null,
    runtime: { storage: "memory", tutor: "deterministic" },
    summaryGenerationStatus: "ready",
    assignment: null,
    teachingClass: null,
  };
}

describe("private teaching-materials integration", () => {
  let temporaryRoot: string | undefined;
  let activeRepository: InMemoryTutorRepository | undefined;

  beforeEach(() => {
    temporaryRoot = undefined;
  });

  afterEach(async () => {
    if (activeRepository) {
      delete process.env.TUTOR_MATERIALS_DIR;
      activeRepository.reset();
      activeRepository = undefined;
    }
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    restoreEnvironment();
  });

  it("loads an opt-in pack and returns bounded literature with provenance", async () => {
    temporaryRoot = await createPackDirectory();

    const pack = await getMaterialPack();
    expect(pack?.rootDir && realpathSync(pack.rootDir).toLocaleLowerCase()).toBe(realpathSync(temporaryRoot).toLocaleLowerCase());
    expect(pack?.cases).toHaveLength(1);
    expect(pack?.cases[0].case.id).toBe(CASE_ID);
    expect(pack?.cases[0].case).not.toHaveProperty("expertNotes");
    expect(pack?.cases[0].case).not.toHaveProperty("sourceDocument");

    const context = getTeachingContext(CASE_ID, "canine localisation evidence");
    expect(context?.expertNotes).toBe("FACULTY_ONLY_SYNTHETIC_NOTE");
    expect(context?.sourceDocument).toBe("synthetic-case.docx");
    expect(context?.literature.length).toBeGreaterThan(0);
    expect(context?.literature.length).toBeLessThanOrEqual(4);
    expect(context?.literature.every((item) => item.sourceId && item.title && item.page > 0 && item.text.length <= 2_000)).toBe(true);
    expect(context?.literature.some((item) => item.sourceId === "synthetic-article-1" && item.page === 2)).toBe(true);
  });

  it("fails closed when local materials are not explicitly enabled", async () => {
    delete process.env.TUTOR_MATERIALS_DIR;
    process.env.FORCE_MEMORY_REPOSITORY = "true";

    expect(await getMaterialPack()).toBeNull();
    expect(getTeachingContext(CASE_ID, "evidence")).toBeUndefined();
  });

  it("adds local cases to memory only in opt-in mode", async () => {
    temporaryRoot = await createPackDirectory();
    const repository = new InMemoryTutorRepository();
    activeRepository = repository;
    repository.reset();

    const cases = await repository.listCases();
    expect(cases.some((item) => item.id === CASE_ID)).toBe(true);
    const offerings = await repository.listStudentOfferings(DEMO_STUDENT_ID);
    expect(offerings.some((item) => item.case.id === CASE_ID)).toBe(true);
    expect(JSON.stringify(offerings)).not.toContain("FACULTY_ONLY_SYNTHETIC_NOTE");

    delete process.env.TUTOR_MATERIALS_DIR;
    repository.reset();
    expect((await repository.listCases()).some((item) => item.id === CASE_ID)).toBe(false);
  });

  it("removes private context and source fields from the student bundle", async () => {
    temporaryRoot = await createPackDirectory();
    const pack = await getMaterialPack();
    const bundle = bundleWithHiddenFields(pack!.cases[0].case);
    const view = studentView(bundle);
    const publicCase = view.case as unknown as Record<string, unknown>;

    expect(publicCase).not.toHaveProperty("expertNotes");
    expect(publicCase).not.toHaveProperty("sourceDocument");
    expect(publicCase).not.toHaveProperty("literature");
    expect(publicCase).not.toHaveProperty("teachingMaterialPackageId");
    const publicPhase = (publicCase.phases as Array<Record<string, unknown>>)[0];
    expect(publicPhase).not.toHaveProperty("tutorGuidance");
    expect(publicPhase).not.toHaveProperty("tutorMoves");
    expect(publicPhase).not.toHaveProperty("examinerNotes");
    expect(publicPhase).not.toHaveProperty("answerKey");
    expect(publicPhase.rubric).toEqual([]);
    expect(publicPhase.starterQuestion).toBe("");
    expect(publicPhase.exampleQuestions).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("FACULTY_ONLY_SYNTHETIC_NOTE");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SOURCE_TEXT");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_TUTOR_GUIDANCE");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_RECORD_ERROR");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_ANSWER_KEY");
  });
});
