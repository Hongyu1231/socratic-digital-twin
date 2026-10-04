import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getMaterialPack } from "@/lib/materials/pack";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";

const originalMaterialsDir = process.env.TUTOR_MATERIALS_DIR;
const originalForceMemory = process.env.FORCE_MEMORY_REPOSITORY;
const originalVercel = process.env.VERCEL;
const temporaryRoots: string[] = [];

function caseInput() {
  return {
    id: CASE_ID,
    title: "Imported local case",
    description: "A synthetic teaching case used by the loader test.",
    difficulty: "intermediate",
    learningObjectives: ["Use evidence carefully."],
    phases: [{
      id: PHASE_ID,
      order: 1,
      title: "Evidence",
      goal: "Connect the finding to a defensible explanation.",
      rubric: ["evidence"],
      starterQuestion: "What evidence supports your explanation?",
      exampleQuestions: ["Which finding would change your view?"],
    }],
  };
}

function createPackRoot(overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socratic-materials-"));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    formatVersion: 1,
    packageId: "pack-test",
    cases: [{ case: caseInput(), expertNotes: "Private examiner note.", sourceDocument: "article.pdf" }],
    articles: [{ id: "article-1", title: "A teaching article", filename: "articles/article.pdf", sha256: "0".repeat(64), pages: [{ page: 1, text: "Evidence supports careful clinical reasoning." }] }],
    media: [],
    ...overrides,
  }));
  return root;
}

afterEach(() => {
  if (originalMaterialsDir === undefined) delete process.env.TUTOR_MATERIALS_DIR;
  else process.env.TUTOR_MATERIALS_DIR = originalMaterialsDir;
  if (originalForceMemory === undefined) delete process.env.FORCE_MEMORY_REPOSITORY;
  else process.env.FORCE_MEMORY_REPOSITORY = originalForceMemory;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local teaching material pack", () => {
  it("keeps pending clinical review metadata server-side while permitting isolated local evaluation", () => {
    const review = { status: "pending", reviewer: null, approvedAt: null, contentSha256: "a".repeat(64) };
    const root = createPackRoot({ clinicalReview: review });
    process.env.TUTOR_MATERIALS_DIR = root;
    process.env.FORCE_MEMORY_REPOSITORY = "true";
    delete process.env.VERCEL;
    const pack = getMaterialPack();
    expect(pack?.clinicalReview).toEqual(review);
    expect(pack?.cases[0].case).not.toHaveProperty("clinicalReview");
  });
  it("returns null when the local pack is not configured", () => {
    delete process.env.TUTOR_MATERIALS_DIR;
    process.env.FORCE_MEMORY_REPOSITORY = "true";
    delete process.env.VERCEL;
    expect(getMaterialPack()).toBeNull();
  });

  it("retains accepted extras as private phase metadata without adding required criteria", () => {
    const input = caseInput();
    const root = createPackRoot({ cases: [{ case: { ...input, phases: [{ ...input.phases[0], acceptedExtras: [{ id: "bonus-parallax", text: "Discusses parallax" }] }] }, expertNotes: "Faculty only", sourceDocument: "synthetic.docx" }] });
    process.env.TUTOR_MATERIALS_DIR = root;
    process.env.FORCE_MEMORY_REPOSITORY = "true";
    delete process.env.VERCEL;
    const phase = getMaterialPack()?.cases[0].case.phases[0];
    expect(phase?.acceptedExtras).toEqual([{ id: "bonus-parallax", text: "Discusses parallax" }]);
    expect(phase?.rubric).toEqual(["evidence"]);
  });

  it("fails closed when a configured pack is running in a production or non-memory mode", () => {
    const root = createPackRoot();
    process.env.TUTOR_MATERIALS_DIR = root;
    process.env.FORCE_MEMORY_REPOSITORY = "true";
    process.env.VERCEL = "1";
    expect(() => getMaterialPack()).toThrow("Local teaching materials are disabled");

    delete process.env.VERCEL;
    process.env.FORCE_MEMORY_REPOSITORY = "false";
    expect(() => getMaterialPack()).toThrow("Local teaching materials are disabled");
  });

  it("reconstructs safe public case fields and keeps expert notes separate", () => {
    const root = createPackRoot({
      cases: [{
        case: { ...caseInput(), status: "draft", version: 99, sourceCaseId: CASE_ID },
        expertNotes: "Do not expose this note in the case object.",
        sourceDocument: "article.pdf",
      }],
    });
    process.env.TUTOR_MATERIALS_DIR = root;
    process.env.FORCE_MEMORY_REPOSITORY = "true";
    delete process.env.VERCEL;

    const pack = getMaterialPack();
    expect(pack?.cases).toHaveLength(1);
    expect(pack?.cases[0].case.status).toBe("available");
    expect(pack?.cases[0].case.version).toBe(1);
    expect(pack?.cases[0].case.sourceCaseId).toBeNull();
    expect(pack?.cases[0].case.phases[0].caseId).toBe(CASE_ID);
    expect(pack?.cases[0].case).not.toHaveProperty("expertNotes");
    expect(pack?.cases[0].expertNotes).toContain("Do not expose");
  });

  it("rejects unsafe relative configuration", () => {
    process.env.TUTOR_MATERIALS_DIR = "..\\private-materials";
    process.env.FORCE_MEMORY_REPOSITORY = "true";
    delete process.env.VERCEL;
    expect(() => getMaterialPack()).toThrow("directory is unsafe");
  });
});
