import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getMaterialPack } from "@/lib/materials/pack";
import { getTeachingContext } from "@/lib/materials/retrieval";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const temporaryRoots: string[] = [];

function configurePack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socratic-materials-retrieval-"));
  temporaryRoots.push(root);
  const longText = `${"Impacted canine root resorption evidence and adjacent lateral incisor findings. ".repeat(100)} End.`;
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    formatVersion: 1,
    packageId: "retrieval-test",
    cases: [{
      case: {
        id: CASE_ID,
        title: "Impacted canine",
        description: "A synthetic impacted canine case for retrieval tests.",
        difficulty: "advanced",
        learningObjectives: ["Assess root resorption risk."],
        phases: [{
          order: 1,
          title: "Radiographic reasoning",
          goal: "Use the OPG findings to explain risk.",
          rubric: ["root resorption"],
          starterQuestion: "What does the image show?",
          exampleQuestions: ["Which finding matters most?"],
        }],
      },
      expertNotes: "x".repeat(7_000),
      sourceDocument: "canine-review.pdf",
    }],
    articles: [
      {
        id: "article-high-value",
        title: "Impacted canine review",
        filename: "articles/canine.pdf",
        sha256: "1".repeat(64),
        pages: [
          { page: 1, text: "General background without the requested finding." },
          { page: 2, text: longText },
          { page: 3, text: "Impacted canine root resorption should be assessed on the lateral incisor." },
        ],
      },
      {
        id: "article-low-value",
        title: "Unrelated article",
        filename: "articles/unrelated.pdf",
        sha256: "2".repeat(64),
        pages: [
          { page: 1, text: "Impacted canine root resorption is mentioned briefly." },
          { page: 2, text: "Impacted canine root resorption is mentioned again." },
          { page: 3, text: "This should be ranked after the focused source." },
        ],
      },
    ],
    media: [],
  }));
  process.env.TUTOR_MATERIALS_DIR = root;
  process.env.FORCE_MEMORY_REPOSITORY = "true";
  delete process.env.VERCEL;
}

afterEach(() => {
  delete process.env.TUTOR_MATERIALS_DIR;
  delete process.env.FORCE_MEMORY_REPOSITORY;
  delete process.env.VERCEL;
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local teaching context retrieval", () => {
  it("returns relevant page provenance, caps notes and limits repeated sources", () => {
    configurePack();
    const context = getTeachingContext(CASE_ID, "impacted canine root resorption lateral incisor");

    expect(context).toBeDefined();
    expect(context?.expertNotes).toHaveLength(6_000);
    expect(context?.sourceDocument).toBe("canine-review.pdf");
    expect(context?.literature.length).toBeLessThanOrEqual(4);
    expect(context?.literature.reduce((total, item) => total + item.text.length, 0)).toBeLessThanOrEqual(6_000);
    expect(new Set(context?.literature.map((item) => `${item.sourceId}:${item.page}`)).size).toBe(context?.literature.length);
    for (const sourceId of new Set(context?.literature.map((item) => item.sourceId))) {
      expect(context?.literature.filter((item) => item.sourceId === sourceId).length).toBeLessThanOrEqual(2);
    }
    expect(context?.literature.some((item) => item.sourceId === "article-high-value" && item.page === 2)).toBe(true);
    expect(context?.literature.every((item) => item.page > 0 && item.title.length > 0)).toBe(true);
  });

  it("skips pages when no query term matches and keeps case context available", () => {
    configurePack();
    const context = getTeachingContext(CASE_ID, "unmatched term");
    expect(context).toBeDefined();
    expect(context?.literature).toEqual([]);
  });

  it("returns undefined for a case outside the pack", () => {
    configurePack();
    expect(getTeachingContext("44444444-4444-4444-8444-444444444444", "canine")).toBeUndefined();
  });

  it("reuses the article index for the same immutable pack", () => {
    configurePack();
    expect(getTeachingContext(CASE_ID, "root resorption")).toBeDefined();
    const pack = getMaterialPack();
    const nonMatchingPage = pack?.articles[0]?.pages[0];
    expect(nonMatchingPage).toBeDefined();
    Object.defineProperty(nonMatchingPage, "text", {
      configurable: true,
      get() {
        throw new Error("The cached index should avoid tokenizing this page again.");
      },
    });

    const repeated = getTeachingContext(CASE_ID, "root resorption");
    expect(repeated?.literature.length).toBeGreaterThan(0);
  });
});
