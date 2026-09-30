import { createClient } from "@supabase/supabase-js";

import type { CaseAttachment, SessionBundle } from "@/lib/domain";

/**
 * The private media bucket is intentionally a constant.  A case row may store
 * an object key, but it must never be able to choose a bucket or a Supabase
 * project at request time.
 */
export const PRIVATE_CASE_MEDIA_BUCKET = "teaching-case-media-private";
export const PRIVATE_CASE_MEDIA_URL_TTL_SECONDS = 60 * 60;
export const PRIVATE_CASE_MEDIA_SIGNING_TIMEOUT_MS = 5_000;
export const PRIVATE_CASE_MEDIA_MAX_RESPONSE_BYTES = 1 * 1024 * 1024;

const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ATTACHMENT_ID = new RegExp(`^${UUID}$`, "i");

/** Fields added by the private-media rollout. Kept local until the shared
 * domain contract is migrated, so this module remains backwards-compatible
 * with existing legacy attachment rows. */
export type CaseMediaAttachment = CaseAttachment & {
  storagePath?: string;
  unlockPhase?: number;
  unlockOnRequest?: false;
};

export type StudentMediaAttachment = Pick<CaseAttachment, "id" | "kind" | "title" | "description" | "transcript" | "sourceLabel" | "unlockPhase"> & {
  /** Private attachments receive a short-lived signed URL. */
  url?: string;
  posterUrl?: string;
  sourceUrl?: string;
  expiresAt?: string;
};

export type PrivateMediaSigner = (
  storagePath: string,
  expiresInSeconds: number,
) => Promise<string>;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CaseMediaResolution {
  attachmentId: string;
  url: string;
  /** Null for legacy URLs, which do not have a server-controlled expiry. */
  expiresAt: string | null;
}

export interface PrepareStudentMediaOptions {
  /** Used by unit tests and by controlled server-side callers. */
  signer?: PrivateMediaSigner;
  expiresInSeconds?: number;
  now?: () => number;
}

export class CaseMediaError extends Error {
  readonly status: 404 | 503;

  constructor(status: 404 | 503, message: string) {
    super(message);
    this.name = "CaseMediaError";
    this.status = status;
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Bound every Storage signing request. Supabase's storage helper receives this
 * fetch implementation once and performs no retry through this wrapper; an
 * abort therefore bounds the entire network wait seen by a student response.
 * The optional arguments make the deadline independently testable without
 * waiting five seconds in a unit test.
 */
export function createPrivateMediaFetch(
  baseFetch: FetchImplementation = globalThis.fetch.bind(globalThis),
  timeoutMs = PRIVATE_CASE_MEDIA_SIGNING_TIMEOUT_MS,
): FetchImplementation {
  return async (input, init = {}) => {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectDeadline: (reason?: unknown) => void = () => undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
      timeout = setTimeout(() => {
        reject(new DOMException("Private media signing request timed out.", "AbortError"));
        controller.abort();
        void reader?.cancel().catch(() => undefined);
      }, timeoutMs);
    });
    const onAbort = () => {
      rejectDeadline(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      controller.abort(init.signal?.reason);
      void reader?.cancel().catch(() => undefined);
    };
    if (init.signal?.aborted) onAbort();
    else init.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await Promise.race([
        baseFetch(input, { ...init, signal: controller.signal }),
        deadline,
      ]);
      let body: Uint8Array<ArrayBuffer> | null = null;
      if (response.body) {
        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > PRIVATE_CASE_MEDIA_MAX_RESPONSE_BYTES) {
          throw new Error("Private media signing response is too large.");
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const result = await Promise.race([reader.read(), deadline]);
          if (result.done) break;
          total += result.value.byteLength;
          if (total > PRIVATE_CASE_MEDIA_MAX_RESPONSE_BYTES) {
            void reader.cancel().catch(() => undefined);
            throw new Error("Private media signing response is too large.");
          }
          chunks.push(result.value);
        }
        body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        reader.releaseLock();
        reader = undefined;
      }

      // A reconstructed response lets the SDK consume `.json()` normally
      // while ensuring the deadline covered headers and the complete body.
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      const noBodyStatus = response.status === 204 || response.status === 205 || response.status === 304;
      const responseBody = noBodyStatus || body === null ? null : body;
      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      if (reader) reader.releaseLock();
      init.signal?.removeEventListener("abort", onAbort);
    }
  };
}

/**
 * Validate a database-owned private object key before passing it to Storage.
 *
 * This is deliberately stricter than a generic path sanitizer: object keys
 * may contain only safe segments, and neither URLs nor traversal notation are
 * accepted. The route never accepts a storage path from the browser; it reads
 * this value from the validated case row and applies this check before use.
 */
export function validatePrivateMediaPath(storagePath: string): string {
  if (
    typeof storagePath !== "string"
    || storagePath.length === 0
    || storagePath.length > 512
    || hasControlCharacters(storagePath)
    || storagePath.includes("\\")
    || storagePath.includes("://")
    || storagePath.startsWith("/")
    || storagePath.endsWith("/")
    || storagePath.includes("//")
  ) {
    throw new CaseMediaError(404, "The teaching attachment is unavailable.");
  }

  const segments = storagePath.split("/");
  if (segments.length < 2 || segments.some((segment) => !SAFE_STORAGE_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    throw new CaseMediaError(404, "The teaching attachment is unavailable.");
  }

  return segments.join("/");
}

function isUnlocked(attachment: CaseMediaAttachment, currentPhase: number): boolean {
  const unlockPhase = attachment.unlockPhase === undefined ? 1 : attachment.unlockPhase;
  return Number.isInteger(unlockPhase) && unlockPhase >= 1 && unlockPhase <= currentPhase;
}

function isLegacyMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || hasControlCharacters(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function getDefaultPrivateMediaSigner(): PrivateMediaSigner {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new CaseMediaError(503, "Private teaching media is not configured.");
  }

  let client;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("invalid Supabase URL");
    }
    client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createPrivateMediaFetch() },
    });
  } catch {
    throw new CaseMediaError(503, "Private teaching media is not configured.");
  }

  return async (storagePath, expiresInSeconds) => {
    try {
      const { data, error } = await client.storage
        .from(PRIVATE_CASE_MEDIA_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);
      if (error || !data?.signedUrl) {
        throw new Error("Storage signing failed");
      }
      return data.signedUrl;
    } catch {
      throw new CaseMediaError(503, "Private teaching media is temporarily unavailable.");
    }
  };
}

/**
 * Resolve one attachment after the caller has authenticated and loaded the
 * owning session. Private media gets a short-lived signed URL. Legacy local or
 * HTTPS URLs are returned unchanged with `expiresAt: null`; this compatibility
 * branch does not fetch, proxy, or otherwise dereference external URLs.
 */
export async function resolveStudentMediaAttachment(
  bundle: SessionBundle,
  attachment: CaseMediaAttachment,
  options: { signer?: PrivateMediaSigner; expiresInSeconds?: number; now?: () => number } = {},
): Promise<CaseMediaResolution> {
  const currentPhase = bundle.session.currentPhase;
  if (!isUnlocked(attachment, currentPhase)) {
    throw new CaseMediaError(404, "The teaching attachment is not available yet.");
  }

  if (attachment.storagePath !== undefined) {
    const storagePath = validatePrivateMediaPath(attachment.storagePath);
    const expiresInSeconds = options.expiresInSeconds ?? PRIVATE_CASE_MEDIA_URL_TTL_SECONDS;
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > 3_600) {
      throw new CaseMediaError(503, "Private teaching media is not configured.");
    }
    const signer = options.signer ?? getDefaultPrivateMediaSigner();
    const url = await signer(storagePath, expiresInSeconds);
    const now = options.now?.() ?? Date.now();
    return {
      attachmentId: attachment.id,
      url,
      expiresAt: new Date(now + expiresInSeconds * 1_000).toISOString(),
    };
  }

  if (isLegacyMediaUrl(attachment.url)) {
    return { attachmentId: attachment.id, url: attachment.url, expiresAt: null };
  }

  throw new CaseMediaError(404, "The teaching attachment is unavailable.");
}

/**
 * Return only phase-unlocked, student-safe attachment metadata. Private
 * object keys are resolved to short-lived signed URLs and are never
 * serialized into the student response. The route remains available for
 * explicit refreshes once a signed URL expires.
 */
export async function prepareStudentMedia(
  bundle: SessionBundle,
  options: PrepareStudentMediaOptions = {},
): Promise<StudentMediaAttachment[]> {
  const attachments = ((bundle.case.attachments ?? []) as CaseMediaAttachment[]).slice(0, 12);

  function safeAttachmentForStudent(attachment: CaseMediaAttachment, isPrivate: boolean): StudentMediaAttachment {
    // Explicit allowlist: do not spread attachment fields into a student
    // response. In particular, private rows never retain stale public URL,
    // poster, or citation fields that could bypass the signing policy.
    const safeAttachment: StudentMediaAttachment = {
      id: attachment.id,
      kind: attachment.kind,
      title: attachment.title,
      description: attachment.description,
      unlockPhase: attachment.unlockPhase ?? 1,
      ...(attachment.transcript ? { transcript: attachment.transcript } : {}),
      ...(attachment.sourceLabel ? { sourceLabel: attachment.sourceLabel } : {}),
    };
    if (!isPrivate) {
      if (isLegacyMediaUrl(attachment.posterUrl)) safeAttachment.posterUrl = attachment.posterUrl;
      if (isLegacyMediaUrl(attachment.sourceUrl)) safeAttachment.sourceUrl = attachment.sourceUrl;
    }
    return safeAttachment;
  }

  return Promise.all(attachments.map(async (attachment) => {
    if (!isUnlocked(attachment, bundle.session.currentPhase)) return null;

    const isPrivate = attachment.storagePath !== undefined;
    const safeAttachment = safeAttachmentForStudent(attachment, isPrivate);

    // Transcript-only audio is a valid legacy attachment and should remain
    // usable even though it has no media URL to resolve.
    if (!isPrivate && !attachment.url && attachment.kind === "audio" && attachment.transcript) {
      return safeAttachment;
    }
    if (!isPrivate && !isLegacyMediaUrl(attachment.url)) return null;

    try {
      const resolved = await resolveStudentMediaAttachment(bundle, attachment, {
        signer: options.signer,
        expiresInSeconds: options.expiresInSeconds,
        now: options.now,
      });
      safeAttachment.url = resolved.url;
      if (isPrivate && resolved.expiresAt) safeAttachment.expiresAt = resolved.expiresAt;
    } catch {
      // Private references fail closed without leaking their object key or a
      // stale public URL. Retain the safe metadata so the UI can show a retry
      // affordance using the attachment id and the refresh route.
      if (!isPrivate) return null;
    }
    return safeAttachment;
  })).then((items) => items.filter((item): item is StudentMediaAttachment => Boolean(item)));
}

export function isAttachmentId(value: string): boolean {
  return ATTACHMENT_ID.test(value);
}
