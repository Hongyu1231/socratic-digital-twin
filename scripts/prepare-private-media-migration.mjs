#!/usr/bin/env node
/* global Buffer, URL */

/**
 * Prepare the existing published teaching media for the private-media cutover.
 *
 * This command is intentionally read-only by default. It discovers only
 * public Storage URLs belonging to this tutor project, verifies every source
 * object, and checks any same-key private object before an optional copy.
 * Metadata is changed by the reviewed SQL cutover after this command succeeds;
 * this script never updates case rows and never deletes public objects.
 *
 * Dry-run (required before rollout):
 *   node --env-file=.env.local scripts/prepare-private-media-migration.mjs
 *
 * Copy only after the application has been deployed with private-media
 * support, and after reviewing the dry-run result:
 *   node --env-file=.env.local scripts/prepare-private-media-migration.mjs --apply
 */

import crypto from "node:crypto";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

export const TUTOR_PROJECT_REF = "zulvdacbqvmqmtotyeuc";
export const PUBLIC_MEDIA_BUCKET = "teaching-case-media";
export const PRIVATE_MEDIA_BUCKET = "teaching-case-media-private";
export const PUBLIC_MEDIA_PREFIX = `/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/`;
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const WEBP_HEADER = Buffer.from("WEBP", "ascii");

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function projectRefFromUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("SUPABASE_URL must be a valid HTTPS project URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    fail("SUPABASE_URL must be a credential-free HTTPS project URL.");
  }
  const match = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
  if (!match) fail("SUPABASE_URL must identify a Supabase project.");
  return match[1].toLowerCase();
}

/**
 * Require the exact tutor project before any Storage read or write. This is a
 * separate guard from Supabase's service-role credential: a valid credential
 * for another project must not be usable by this migration helper.
 */
export function assertTutorProject(supabaseUrl, expectedProjectRef) {
  const actualProjectRef = projectRefFromUrl(supabaseUrl);
  const expected = String(expectedProjectRef ?? "").trim().toLowerCase();
  if (expected !== TUTOR_PROJECT_REF || actualProjectRef !== expected) {
    fail("EXPECTED_SUPABASE_PROJECT_REF must match the tutor Supabase project.");
  }
  return actualProjectRef;
}

function safeObjectKey(value) {
  if (typeof value !== "string" || value.length < 3 || value.length > 512 || value.includes("\\") || value.includes("//")) return null;
  const segments = value.split("/");
  if (segments.length < 2 || segments.some((segment) => !SAFE_SEGMENT.test(segment) || segment === "." || segment === "..")) return null;
  if (!/\.webp$/i.test(segments.at(-1))) return null;
  return segments.join("/");
}

/**
 * Return a safe object key only for the exact public Storage origin and bucket.
 * Unsupported URLs are ignored by discovery (they may be genuine citations),
 * and are never fetched by this script.
 */
export function parseTutorPublicMediaUrl(value, supabaseUrl) {
  if (typeof value !== "string" || value.length === 0) return null;
  let configuredOrigin;
  let parsed;
  try {
    configuredOrigin = new URL(supabaseUrl).origin;
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.origin !== configuredOrigin || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null;
  if (parsed.pathname.includes("%")) return null;
  if (!parsed.pathname.startsWith(PUBLIC_MEDIA_PREFIX)) return null;
  return safeObjectKey(parsed.pathname.slice(PUBLIC_MEDIA_PREFIX.length));
}

function isMissingStorageObjectError(error) {
  if (!error || typeof error !== "object") return false;
  const statusCode = Number(error.statusCode);
  const status = Number(error.status);
  if (statusCode === 404 || status === 404) return true;
  return [error.code, error.name].some((value) => /^(?:404|not[_-]?found)$/i.test(String(value ?? "")));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isWebp(bytes) {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).equals(WEBP_HEADER);
}

async function readStorageObject(client, bucket, key) {
  const { data, error } = await client.storage.from(bucket).download(key);
  if (error) {
    if (isMissingStorageObjectError(error)) return { missing: true };
    throw new Error("Could not read a referenced teaching-media object.");
  }
  if (!data) throw new Error("Storage returned no teaching-media object bytes.");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > MAX_OBJECT_BYTES) throw new Error("A teaching-media object exceeds the private bucket size limit.");
  return { missing: false, bytes, contentType: String(data.type ?? "").split(";", 1)[0].toLowerCase() };
}

function assertWebpSource(object) {
  if (object.missing || !object.bytes || !isWebp(object.bytes)) {
    throw new Error("A referenced public teaching-media object is not a valid WebP.");
  }
  if (object.contentType && object.contentType !== "image/webp") {
    throw new Error("A referenced public teaching-media object is not marked image/webp.");
  }
}

/**
 * Discover object keys in both the current attachment column and the legacy
 * patient_context mirror. The returned keys are deduplicated and contain no
 * case text or row identifiers.
 */
export function collectReferencedMedia(caseRows, supabaseUrl) {
  const keys = new Set();
  for (const row of caseRows ?? []) {
    const attachmentArrays = [
      row?.attachments,
      isObject(row?.patient_context) ? row.patient_context.attachments : undefined,
    ];
    for (const attachments of attachmentArrays) {
      if (!Array.isArray(attachments)) continue;
      for (const attachment of attachments) {
        if (!isObject(attachment)) continue;
        for (const field of ["url", "sourceUrl"]) {
          const key = parseTutorPublicMediaUrl(attachment[field], supabaseUrl);
          if (key) keys.add(key);
        }
      }
    }
  }
  return [...keys].sort();
}

async function readCaseRows(client) {
  const { data, error } = await client.from("cases").select("id,attachments,patient_context");
  if (error) throw new Error("Could not read existing case media metadata.");
  return Array.isArray(data) ? data : [];
}

async function inspectReferencedObject(client, key) {
  const source = await readStorageObject(client, PUBLIC_MEDIA_BUCKET, key);
  assertWebpSource(source);
  const target = await readStorageObject(client, PRIVATE_MEDIA_BUCKET, key);
  if (!target.missing && !target.bytes) throw new Error("Private teaching-media object could not be inspected.");
  if (!target.missing && sha256(target.bytes) !== sha256(source.bytes)) {
    throw new Error("A private teaching-media object differs from its public source; refusing overwrite.");
  }
  return {
    key,
    sourceHash: sha256(source.bytes),
    targetExists: !target.missing,
  };
}

async function copyInspectedObject(client, inspection) {
  const source = await readStorageObject(client, PUBLIC_MEDIA_BUCKET, inspection.key);
  assertWebpSource(source);
  if (sha256(source.bytes) !== inspection.sourceHash) {
    throw new Error("A public teaching-media object changed during preparation; refusing copy.");
  }
  const { error } = await client.storage.from(PRIVATE_MEDIA_BUCKET).upload(inspection.key, source.bytes, {
    contentType: "image/webp",
    cacheControl: "0",
    upsert: false,
  });
  if (!error) {
    // A successful upload response is not enough to claim the copy completed:
    // verify the object through the Storage read path before reporting success.
    const verified = await readStorageObject(client, PRIVATE_MEDIA_BUCKET, inspection.key);
    if (verified.missing || !verified.bytes || sha256(verified.bytes) !== inspection.sourceHash) {
      throw new Error("Private teaching-media upload verification failed; refusing to report success.");
    }
    if (verified.contentType && verified.contentType !== "image/webp") {
      throw new Error("Private teaching-media upload has an unexpected content type; refusing to report success.");
    }
    return "uploaded";
  }
  if (!isMissingStorageObjectError(error) && !/already exists|duplicate|conflict/i.test(String(error.message ?? error))) {
    throw new Error("Could not copy a teaching-media object to the private bucket.");
  }
  const raced = await readStorageObject(client, PRIVATE_MEDIA_BUCKET, inspection.key);
  if (raced.missing || sha256(raced.bytes) !== inspection.sourceHash) {
    throw new Error("A raced private teaching-media object differs from its public source; refusing overwrite.");
  }
  return "existing";
}

/**
 * Inspect all references before the first write. This makes --apply safe to
 * retry and avoids a partial copy when a source object is missing or corrupt.
 */
export async function preparePrivateMediaMigration({ client, supabaseUrl, apply = false }) {
  assertTutorProject(supabaseUrl, process.env.EXPECTED_SUPABASE_PROJECT_REF);
  const caseRows = await readCaseRows(client);
  const keys = collectReferencedMedia(caseRows, supabaseUrl);
  const inspections = [];
  for (const key of keys) inspections.push(await inspectReferencedObject(client, key));

  let copied = 0;
  let existing = inspections.filter((item) => item.targetExists).length;
  if (apply) {
    for (const inspection of inspections.filter((item) => !item.targetExists)) {
      const result = await copyInspectedObject(client, inspection);
      if (result === "uploaded") copied += 1;
      else existing += 1;
    }
  }

  return {
    applied: Boolean(apply),
    casesScanned: caseRows.length,
    references: keys.length,
    alreadyPrivate: existing,
    toCopy: inspections.filter((item) => !item.targetExists).length,
    copied,
  };
}

function parseArgs(argv) {
  const options = { apply: false, help: false };
  for (const argument of argv) {
    if (argument === "--apply") options.apply = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else fail(`Unknown option: ${argument}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    "Prepare existing public teaching media for the private bucket.",
    "Default: read-only dry-run. Writes require --apply.",
    "Required environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPECTED_SUPABASE_PROJECT_REF.",
    "No case metadata is changed; run the reviewed SQL cutover only after this succeeds.",
  ].join("\n") + "\n");
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { help: true };
  }
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim();
  if (!supabaseUrl || !serviceRoleKey || !expectedProjectRef) {
    fail("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and EXPECTED_SUPABASE_PROJECT_REF are required.");
  }
  assertTutorProject(supabaseUrl, expectedProjectRef);
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await preparePrivateMediaMigration({ client, supabaseUrl, apply: options.apply });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Private-media preparation failed."}\n`);
    process.exitCode = 1;
  });
}
