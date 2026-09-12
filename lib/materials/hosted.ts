import { MAX_MANIFEST_BYTES, parseMaterialManifest, type MaterialPack } from "@/lib/materials/pack";

/**
 * Private reference manifests and public case media are kept in separate
 * buckets. This module only reads the private manifest; public case
 * attachment URLs are handled by the media delivery path.
 */
export const HOSTED_REFERENCE_BUCKET = "teaching-material-references";
export const HOSTED_MEDIA_BUCKET = "teaching-case-media";
export const HOSTED_DOWNLOAD_TIMEOUT_MS = 5_000;
export const HOSTED_PACK_CACHE_SIZE = 4;
export const HOSTED_PACKAGE_ID = /^[a-f0-9]{64}$/i;

const RETRYABLE_ERROR = "Teaching materials are temporarily unavailable. Please retry.";
const INVALID_ERROR = "Hosted teaching materials are invalid.";

const hostedPackCache = new Map<string, MaterialPack>();
const hostedPackInflight = new Map<string, Promise<MaterialPack>>();

function normalizePackageId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HOSTED_PACKAGE_ID.test(normalized)) throw new Error(RETRYABLE_ERROR);
  return normalized;
}

function storageObjectUrl(baseUrl: string, bucket: string, packageId: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(RETRYABLE_ERROR);
  }
  const prefix = url.pathname.replace(/\/$/, "");
  const path = [prefix, "storage", "v1", "object", encodeURIComponent(bucket), encodeURIComponent(packageId), "manifest.json"]
    .filter(Boolean)
    .join("/");
  url.pathname = path.startsWith("/") ? path : `/${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readBoundedResponse(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_MANIFEST_BYTES) {
      throw new Error(INVALID_ERROR);
    }
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error(INVALID_ERROR);
    return new TextDecoder().decode(bytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        throw new Error(INVALID_ERROR);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function downloadHostedManifest(packageId: string): Promise<MaterialPack> {
  if (typeof window !== "undefined") throw new Error(RETRYABLE_ERROR);
  const baseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceRoleKey) throw new Error(RETRYABLE_ERROR);

  let url: string;
  try {
    url = storageObjectUrl(baseUrl, HOSTED_REFERENCE_BUCKET, packageId);
  } catch {
    throw new Error(RETRYABLE_ERROR);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOSTED_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(RETRYABLE_ERROR);
    const text = await readBoundedResponse(response);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(INVALID_ERROR);
    }
    let pack: MaterialPack;
    try {
      pack = parseMaterialManifest(raw, "");
    } catch {
      throw new Error(INVALID_ERROR);
    }
    if (pack.packageId.toLowerCase() !== packageId) throw new Error(INVALID_ERROR);
    return pack;
  } catch (error) {
    if (error instanceof Error && (error.message === RETRYABLE_ERROR || error.message === INVALID_ERROR)) throw error;
    throw new Error(RETRYABLE_ERROR);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read an immutable hosted pack by its validated content-addressed package
 * pointer. Only the fixed Supabase Storage object path is ever fetched.
 */
export async function getHostedMaterialPack(packageId: string): Promise<MaterialPack> {
  const normalized = normalizePackageId(packageId);
  const cached = hostedPackCache.get(normalized);
  if (cached) {
    hostedPackCache.delete(normalized);
    hostedPackCache.set(normalized, cached);
    return cached;
  }

  const existing = hostedPackInflight.get(normalized);
  if (existing) return existing;

  const pending = downloadHostedManifest(normalized)
    .then((pack) => {
      hostedPackCache.set(normalized, pack);
      while (hostedPackCache.size > HOSTED_PACK_CACHE_SIZE) {
        const oldest = hostedPackCache.keys().next().value as string | undefined;
        if (!oldest) break;
        hostedPackCache.delete(oldest);
      }
      return pack;
    })
    .finally(() => {
      hostedPackInflight.delete(normalized);
    });
  hostedPackInflight.set(normalized, pending);
  return pending;
}

/** Test-only reset; it never performs a network or storage mutation. */
export function resetHostedMaterialCacheForTests() {
  hostedPackCache.clear();
  hostedPackInflight.clear();
}

export const hostedMaterialErrorMessage = RETRYABLE_ERROR;
