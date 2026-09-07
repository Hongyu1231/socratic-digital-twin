import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/materials/[id]/route";

const CASE_ID = "55555555-5555-4555-8555-555555555555";
const MEDIA_ID = "66666666-6666-4666-8666-666666666666";
const temporaryRoots: string[] = [];

function caseInput() {
  return {
    id: CASE_ID,
    title: "Media route case",
    description: "A synthetic case for the loopback media route.",
    difficulty: "intermediate",
    learningObjectives: ["Read the image."],
    phases: [{
      order: 1,
      title: "Image reading",
      goal: "Describe the image evidence.",
      rubric: ["image evidence"],
      starterQuestion: "What do you see?",
      exampleQuestions: ["What would you check next?"],
    }],
  };
}

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socratic-materials-media-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "media"));
  fs.writeFileSync(path.join(root, "media", `${MEDIA_ID}.webp`), Buffer.from("RIFF-test-webp"));
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({
    formatVersion: 1,
    packageId: "media-route-test",
    cases: [{ case: caseInput(), expertNotes: "private", sourceDocument: "source.pdf" }],
    articles: [],
    media: [{
      id: MEDIA_ID,
      caseId: CASE_ID,
      file: `media/${MEDIA_ID}.webp`,
      mimeType: "image/webp",
      sha256: "0".repeat(64),
      width: 10,
      height: 10,
    }],
  }));
  process.env.TUTOR_MATERIALS_DIR = root;
  process.env.FORCE_MEMORY_REPOSITORY = "true";
  delete process.env.VERCEL;
  return root;
}

afterEach(() => {
  delete process.env.TUTOR_MATERIALS_DIR;
  delete process.env.FORCE_MEMORY_REPOSITORY;
  delete process.env.VERCEL;
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local material media route", () => {
  it("serves only registered media on a loopback host", async () => {
    createRoot();
    const response = await GET(new Request(`http://localhost/api/materials/${MEDIA_ID}`, { headers: { host: "localhost:3000" } }), { params: Promise.resolve({ id: MEDIA_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("RIFF-test-webp");
  });

  it("rejects non-loopback hosts and unregistered ids", async () => {
    createRoot();
    const external = await GET(new Request("http://example.test/api/materials/66666666-6666-4666-8666-666666666666", { headers: { host: "example.test" } }), { params: Promise.resolve({ id: MEDIA_ID }) });
    expect(external.status).toBe(404);

    const unknown = await GET(new Request("http://localhost/api/materials/77777777-7777-4777-8777-777777777777", { headers: { host: "localhost" } }), { params: Promise.resolve({ id: "77777777-7777-4777-8777-777777777777" }) });
    expect(unknown.status).toBe(404);
  });

  it("rejects a registered media id whose file symlink escapes the pack root", async () => {
    const root = createRoot();
    const mediaPath = path.join(root, "media", `${MEDIA_ID}.webp`);
    const outside = path.join(os.tmpdir(), `socratic-material-outside-${Date.now()}.webp`);
    fs.writeFileSync(outside, Buffer.from("outside"));
    try {
      fs.rmSync(mediaPath, { force: true });
      fs.symlinkSync(outside, mediaPath, "file");
    } catch {
      fs.rmSync(outside, { force: true });
      return;
    }
    try {
      const response = await GET(new Request("http://localhost/api/materials/media", { headers: { host: "127.0.0.1:3000" } }), { params: Promise.resolve({ id: MEDIA_ID }) });
      expect(response.status).toBe(404);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
