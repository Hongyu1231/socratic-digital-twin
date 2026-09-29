import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClient,
}));

import type { SessionBundle } from "@/lib/domain";
import {
  CaseMediaError,
  createPrivateMediaFetch,
  prepareStudentMedia,
  resolveStudentMediaAttachment,
  validatePrivateMediaPath,
} from "@/lib/case-media";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const PRIVATE_ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";
const LEGACY_ATTACHMENT_ID = "44444444-4444-4444-8444-444444444444";
const LOCKED_ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
const TRANSCRIPT_ATTACHMENT_ID = "77777777-7777-4777-8777-777777777777";

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function bundle(currentPhase = 1): SessionBundle {
  return {
    session: {
      id: SESSION_ID,
      studentId: "66666666-6666-4666-8666-666666666666",
      caseId: CASE_ID,
      currentPhase,
      status: "active",
      reviewStatus: "pending",
      score: null,
      summary: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      messages: [],
      evaluations: [],
      state: {} as SessionBundle["session"]["state"],
    },
    case: {
      id: CASE_ID,
      title: "Private media case",
      description: "A bounded media test case.",
      difficulty: "intermediate",
      status: "available",
      learningObjectives: ["Read the record."],
      phases: [],
      attachments: [
        {
          id: PRIVATE_ATTACHMENT_ID,
          kind: "image",
          title: "Private OPG",
          description: "A private teaching image.",
          storagePath: "a".repeat(64) + "/" + PRIVATE_ATTACHMENT_ID + ".webp",
          unlockPhase: 1,
          unlockOnRequest: false,
        },
        {
          id: LEGACY_ATTACHMENT_ID,
          kind: "image",
          title: "Legacy image",
          description: "A legacy teaching image.",
          url: "/media/legacy.webp",
        },
        {
          id: LOCKED_ATTACHMENT_ID,
          kind: "image",
          title: "Later image",
          description: "A later-phase teaching image.",
          storagePath: "a".repeat(64) + "/" + LOCKED_ATTACHMENT_ID + ".webp",
          unlockPhase: 2,
        },
        {
          id: TRANSCRIPT_ATTACHMENT_ID,
          kind: "audio",
          title: "Narrated record",
          description: "A transcript-only legacy attachment.",
          transcript: "Describe the record before interpreting it.",
        },
      ],
    },
    student: { id: "66666666-6666-4666-8666-666666666666", name: "Student", email: "student@example.test", role: "student" },
    answerReviews: [],
    tutorTurnReviews: [],
    sessionReview: null,
    runtime: { storage: "memory", tutor: "deterministic" },
    summaryGenerationStatus: "ready",
  } as SessionBundle;
}

afterEach(() => {
  if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalSupabaseUrl;
  if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  supabaseMocks.createClient.mockReset();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  supabaseMocks.createClient.mockReset();
});

describe("private case media", () => {
  it("rejects URLs and traversal from private object keys", () => {
    expect(() => validatePrivateMediaPath("https://evil.example/media.webp")).toThrow(CaseMediaError);
    expect(() => validatePrivateMediaPath("package/../media.webp")).toThrow(CaseMediaError);
    expect(() => validatePrivateMediaPath("/package/media.webp")).toThrow(CaseMediaError);
    expect(validatePrivateMediaPath("package/media.webp")).toBe("package/media.webp");
  });

  it("signs an unlocked private attachment with the injected signer", async () => {
    const signer = vi.fn(async (path: string, ttl: number) => {
      expect(path).toContain(PRIVATE_ATTACHMENT_ID);
      expect(ttl).toBe(3600);
      return "https://signed.example/private.webp?token=test";
    });

    await expect(resolveStudentMediaAttachment(bundle(), bundle().case.attachments![0] as never, {
      signer,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    })).resolves.toEqual({
      attachmentId: PRIVATE_ATTACHMENT_ID,
      url: "https://signed.example/private.webp?token=test",
      expiresAt: "2026-01-01T01:00:00.000Z",
    });
    expect(signer).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a private attachment cannot be configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(resolveStudentMediaAttachment(bundle(), bundle().case.attachments![0] as never)).rejects.toMatchObject({ status: 503 });
  });

  it("bounds the Storage signing fetch with an abortable deadline", async () => {
    const baseFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
    }));
    const boundedFetch = createPrivateMediaFetch(baseFetch, 10);

    await expect(boundedFetch("https://supabase.example/storage", { method: "POST" })).rejects.toMatchObject({ name: "AbortError" });
    expect(baseFetch).toHaveBeenCalledWith("https://supabase.example/storage", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("keeps the deadline through a response body that stalls after headers", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        // Deliberately leave the stream open: a fetch promise can resolve after
        // headers while the SDK is still waiting for the JSON body.
      },
    });
    const baseFetch = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const boundedFetch = createPrivateMediaFetch(baseFetch, 10);

    await expect(boundedFetch("https://supabase.example/storage", { method: "POST" }))
      .rejects.toThrow(/timed out/i);
  });

  it("maps a default signer network failure to a safe 503 and keeps a placeholder", async () => {
    process.env.SUPABASE_URL = "https://zulvdacbqvmqmtotyeuc.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    const createSignedUrl = vi.fn(async () => {
      throw new DOMException("Timed out", "AbortError");
    });
    supabaseMocks.createClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    await expect(resolveStudentMediaAttachment(bundle(), bundle().case.attachments![0] as never)).rejects.toMatchObject({ status: 503 });
    const prepared = await prepareStudentMedia(bundle());
    const privateItem = prepared.find((item) => item.id === PRIVATE_ATTACHMENT_ID);
    expect(privateItem).toMatchObject({ id: PRIVATE_ATTACHMENT_ID, title: "Private OPG" });
    expect(privateItem).not.toHaveProperty("url");
    expect(JSON.stringify(privateItem)).not.toContain("storagePath");
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
        global: expect.objectContaining({ fetch: expect.any(Function) }),
      }),
    );
  });

  it("does not sign or expose locked attachments", async () => {
    const signer = vi.fn(async () => "https://signed.example/locked.webp");
    const current = bundle(1);
    const locked = current.case.attachments![2] as never;
    await expect(resolveStudentMediaAttachment(current, locked, { signer })).rejects.toMatchObject({ status: 404 });
    expect(signer).not.toHaveBeenCalled();
    await expect(prepareStudentMedia(current, {
      signer,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    })).resolves.toEqual([
      expect.objectContaining({
        id: PRIVATE_ATTACHMENT_ID,
        url: "https://signed.example/locked.webp",
        expiresAt: "2026-01-01T01:00:00.000Z",
      }),
      expect.objectContaining({ id: LEGACY_ATTACHMENT_ID, url: "/media/legacy.webp" }),
      expect.objectContaining({ id: TRANSCRIPT_ATTACHMENT_ID, transcript: "Describe the record before interpreting it." }),
    ]);
    const prepared = await prepareStudentMedia(current, { signer });
    expect(JSON.stringify(prepared)).not.toContain("storagePath");
    expect(signer).toHaveBeenCalledTimes(2);
  });

  it("retains safe private metadata on signer failure and keeps transcript-only audio", async () => {
    const current = bundle();
    const signer = vi.fn(async () => {
      throw new CaseMediaError(503, "Private teaching media is temporarily unavailable.");
    });

    const prepared = await prepareStudentMedia(current, { signer });
    const privateItem = prepared.find((item) => item.id === PRIVATE_ATTACHMENT_ID);
    expect(privateItem).toMatchObject({ id: PRIVATE_ATTACHMENT_ID, title: "Private OPG", description: "A private teaching image." });
    expect(privateItem).not.toHaveProperty("url");
    expect(privateItem).not.toHaveProperty("storagePath");
    expect(prepared).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: LEGACY_ATTACHMENT_ID, url: "/media/legacy.webp" }),
      expect.objectContaining({ id: TRANSCRIPT_ATTACHMENT_ID, transcript: "Describe the record before interpreting it." }),
    ]));
  });

  it("returns legacy local URLs without fetching or inventing an expiry", async () => {
    const current = bundle();
    const legacy = current.case.attachments![1] as never;
    await expect(resolveStudentMediaAttachment(current, legacy)).resolves.toEqual({
      attachmentId: LEGACY_ATTACHMENT_ID,
      url: "/media/legacy.webp",
      expiresAt: null,
    });
  });
});
