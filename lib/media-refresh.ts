import { readJsonBody, requestSignal } from "@/lib/client-request";

type MediaReference = { id: string; url?: string; expiresAt?: string };

export function needsMediaRefresh(attachment: MediaReference, now = Date.now()): boolean {
  if (!attachment.url) return true;
  if (!attachment.expiresAt) return false;
  const expires = Date.parse(attachment.expiresAt);
  return !Number.isFinite(expires) || expires <= now + 30_000;
}

function safeMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Refresh by identifiers only. Never accept storage paths from the browser. */
export async function refreshMediaReference(sessionId: string, attachmentId: string, controller: AbortController) {
  const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}/url`, {
    cache: "no-store",
    signal: requestSignal(10_000, controller),
  });
  const data = await readJsonBody<{ attachmentId?: unknown; url?: unknown; expiresAt?: unknown }>(response, "Teaching media could not be loaded. Please try again.");
  if (!response.ok || data.attachmentId !== attachmentId || !safeMediaUrl(data.url)
    || !(data.expiresAt === null || (typeof data.expiresAt === "string" && Number.isFinite(Date.parse(data.expiresAt))))) {
    throw new Error("Teaching media could not be loaded. Please try again.");
  }
  return { url: data.url, expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : undefined };
}
