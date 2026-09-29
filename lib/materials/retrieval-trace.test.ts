import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getTeachingContext,
  getTeachingContextWithTrace,
  getTeachingContextWithTraceAsync,
} from "@/lib/materials/retrieval";

const CASE_ID = "55555555-5555-4555-8555-555555555555";
const temporaryRoots: string[] = [];

function configurePack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socratic-materials-retrieval-trace-"));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    formatVersion: 1,
    packageId: "retrieval-trace-test",
    cases: [{
      case: {
        id: CASE_ID,
        title: "Trace test case",
        description: "A synthetic case for retrieval trace tests.",
        difficulty: "advanced",
        learningObjectives: ["Use evidence."],
        phases: [{
          order: 1,
          title: "Observe",
          goal: "Describe the supplied evidence.",
          rubric: ["specific observation"],
          starterQuestion: "What do you notice?",
          exampleQuestions: ["Which record supports that?"],
        }],
      },
      expertNotes: "PRIVATE_TRACE_EXPERT_NOTE",
      sourceDocument: "private-trace-source.docx",
    }],
    articles: [
      {
        id: "trace-focused-source",
        title: "Focused source",
        filename: "articles/focused.pdf",
        sha256: "1".repeat(64),
        pages: [{
          page: 1,
          locator: "page:1",
          text: "PRIVATE_TRACE_PASSAGE: canine root resorption evidence.",
        }],
      },
      {
        id: "trace-general-source",
        title: "General source",
        filename: "articles/general.pdf",
        sha256: "2".repeat(64),
        pages: [{
          page: 1,
          text: "Canine evidence is mentioned in general background.",
        }],
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

describe("metadata-only teaching retrieval traces", () => {
  it("keeps the legacy context unchanged and records the actual selected scores", () => {
    configurePack();
    const query = "canine root";
    const legacy = getTeachingContext(CASE_ID, query);
    const traced = getTeachingContextWithTrace(CASE_ID, query);

    expect(traced.context).toEqual(legacy);
    expect(traced.trace.query).toBe(query);
    expect(traced.trace.passages).toEqual([
      {
        sourceId: "trace-focused-source",
        page: 1,
        locator: "page:1",
        score: expect.closeTo(3.247377895945022, 10),
      },
      {
        sourceId: "trace-general-source",
        page: 1,
        score: expect.closeTo(1.35, 10),
      },
    ]);
    expect(traced.context?.literature.every((passage) => !Object.hasOwn(passage, "score"))).toBe(true);
  });

  it("does not leak passage or private context content into the trace", () => {
    configurePack();
    const traced = getTeachingContextWithTrace(CASE_ID, "canine root");
    const serializedTrace = JSON.stringify(traced.trace);

    expect(serializedTrace).not.toContain("PRIVATE_TRACE_PASSAGE");
    expect(serializedTrace).not.toContain("PRIVATE_TRACE_EXPERT_NOTE");
    expect(serializedTrace).not.toContain("private-trace-source.docx");
    expect(serializedTrace).not.toContain("Focused source");
    expect(Object.keys(traced.trace.passages[0] ?? {}).sort()).toEqual(["locator", "page", "score", "sourceId"]);
  });

  it("returns deterministic empty traces and keeps sync/async local retrieval in parity", async () => {
    configurePack();
    const query = "unmatched terminology";
    const unknown = getTeachingContextWithTrace("66666666-6666-4666-8666-666666666666", query);
    expect(unknown).toEqual({ context: undefined, trace: { query, passages: [] } });

    const noMatch = getTeachingContextWithTrace(CASE_ID, query);
    expect(noMatch.context).toBeDefined();
    expect(noMatch.trace).toEqual({ query, passages: [] });

    const sync = getTeachingContextWithTrace(CASE_ID, "canine root");
    const asyncResult = await getTeachingContextWithTraceAsync(CASE_ID, "canine root");
    expect(asyncResult).toEqual(sync);

    const longQuery = "x".repeat(2_500);
    expect(getTeachingContextWithTrace(CASE_ID, longQuery).trace.query).toHaveLength(2_000);
  });
});
