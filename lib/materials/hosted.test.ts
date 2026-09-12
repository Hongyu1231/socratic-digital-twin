import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getTeachingContextAsync } from "@/lib/materials/retrieval";
import {
  HOSTED_PACK_CACHE_SIZE,
  HOSTED_DOWNLOAD_TIMEOUT_MS,
  getHostedMaterialPack,
  hostedMaterialErrorMessage,
  resetHostedMaterialCacheForTests,
} from "@/lib/materials/hosted";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PACKAGE_ID = "a".repeat(64);

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

function manifest(packageId = PACKAGE_ID, caseId = CASE_ID) {
  return {
    formatVersion: 1,
    packageId,
    cases: [{
      case: {
        id: caseId,
        title: "Hosted synthetic case",
        description: "A bounded case for hosted material tests.",
        difficulty: "advanced",
        learningObjectives: ["Use evidence."],
        phases: [{
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          caseId,
          order: 1,
          title: "Observe",
          goal: "Describe the evidence.",
          rubric: ["specific evidence"],
          starterQuestion: "What do you notice?",
          exampleQuestions: ["Which record supports that?"],
        }],
        attachments: [],
      },
      expertNotes: "HOSTED_PRIVATE_NOTE",
      sourceDocument: "hosted-case.docx",
    }],
    articles: [{
      id: "hosted-article",
      title: "Hosted evidence article",
      filename: "hosted.pdf",
      sha256: "b".repeat(64),
      sourceType: "expert_interview",
      pages: [{
        page: 1,
        text: "Canine localisation evidence should be tied to the supplied record.",
        locator: "paragraph:7",
        expert: "Hosted expert panel",
        section: "Clinical reasoning",
        caseIds: [caseId],
      }],
    }],
    media: [],
  };
}

function responseFor(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("hosted teaching materials", () => {
  beforeEach(() => {
    resetHostedMaterialCacheForTests();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  });

  afterEach(() => {
    resetHostedMaterialCacheForTests();
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
    vi.useRealTimers();
  });

  it("deduplicates concurrent downloads and serves subsequent reads from the bounded cache", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return responseFor(manifest());
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const [first, second] = await Promise.all([
      getHostedMaterialPack(PACKAGE_ID),
      getHostedMaterialPack(PACKAGE_ID),
    ]);

    expect(first.packageId).toBe(PACKAGE_ID);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.supabase.co/storage/v1/object/teaching-material-references/" + PACKAGE_ID + "/manifest.json",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ apikey: "service-role-test" }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("rejects malformed pointers before any storage request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(getHostedMaterialPack("not-a-package")).rejects.toThrow(hostedMaterialErrorMessage);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send the service role key over a non-HTTPS storage URL", async () => {
    process.env.SUPABASE_URL = "http://example.supabase.co";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(getHostedMaterialPack(PACKAGE_ID)).rejects.toThrow(hostedMaterialErrorMessage);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or mismatched hosted manifest with safe errors", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(getHostedMaterialPack(PACKAGE_ID)).rejects.toThrow(hostedMaterialErrorMessage);

    resetHostedMaterialCacheForTests();
    globalThis.fetch = vi.fn(async () => responseFor(manifest("c".repeat(64)))) as typeof fetch;
    await expect(getHostedMaterialPack(PACKAGE_ID)).rejects.toThrow("Hosted teaching materials are invalid");
  });

  it("aborts a slow manifest download at the bounded deadline", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_input, init) => {
      signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("network aborted")), { once: true });
      });
    }) as typeof fetch;

    const pending = getHostedMaterialPack(PACKAGE_ID);
    const rejection = expect(pending).rejects.toThrow(hostedMaterialErrorMessage);
    await vi.advanceTimersByTimeAsync(HOSTED_DOWNLOAD_TIMEOUT_MS);
    await rejection;
    expect(signal?.aborted).toBe(true);
  });

  it("keeps the lexical literature selection and fails closed for an unknown case", async () => {
    globalThis.fetch = vi.fn(async () => responseFor(manifest())) as typeof fetch;

    const context = await getTeachingContextAsync(CASE_ID, "canine localisation evidence", PACKAGE_ID);
    expect(context?.expertNotes).toBe("HOSTED_PRIVATE_NOTE");
    expect(context?.literature).toEqual([
      expect.objectContaining({
        sourceId: "hosted-article",
        page: 1,
        sourceType: "expert_interview",
        locator: "paragraph:7",
        expert: "Hosted expert panel",
        section: "Clinical reasoning",
      }),
    ]);

    await expect(getTeachingContextAsync(OTHER_CASE_ID, "evidence", PACKAGE_ID))
      .rejects.toThrow(hostedMaterialErrorMessage);
  });

  it("keeps the cache bounded to the configured pack count", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const id = String(input).split("/").at(-2) ?? "";
      return responseFor(manifest(id, CASE_ID));
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const packageIds = Array.from({ length: HOSTED_PACK_CACHE_SIZE + 1 }, (_, index) =>
      String(index + 1).repeat(64).slice(0, 64),
    );

    for (const packageId of packageIds) await getHostedMaterialPack(packageId);
    await getHostedMaterialPack(packageIds[0]);
    expect(fetchMock).toHaveBeenCalledTimes(HOSTED_PACK_CACHE_SIZE + 2);
  });
});
