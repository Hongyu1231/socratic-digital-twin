#!/usr/bin/env node

/**
 * Publish an imported teaching-materials pack to Supabase.
 *
 * This command is deliberately conservative:
 *  - dry-run is the default;
 *  - writes require --apply and an exact --confirm-project value;
 *  - the private reference manifest is kept in a private bucket;
 *  - only registered WebP attachments are copied to the public media bucket;
 *  - existing objects and published rows are never overwritten.
 *
 * Use with Node's env-file support, for example:
 *   node --env-file=.env.local scripts/publish-teaching-materials.mjs \
 *     --apply --confirm-project <project-ref> --class-id <uuid> \
 *     --professor-id <uuid> --admin-id <uuid> --materials-dir work/teaching-materials
 *
 * Add --publish only after the runtime that understands the private material
 * pointer has been deployed. Without it, this command stages media and cases
 * as drafts and creates no assignments.
 */

import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

export const PRIVATE_BUCKET = "teaching-material-references";
export const PUBLIC_BUCKET = "teaching-case-media";
export const PRIVATE_MANIFEST_PATH = (packageId) => `${packageId}/manifest.json`;
export const PUBLIC_MEDIA_PATH = (packageId, mediaId) => `${packageId}/${mediaId}.webp`;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const SHA256_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKAGE_RE = /^[a-f0-9]{64}$/;
const MEDIA_FILE_RE = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

const VALUE_FLAGS = new Set([
  "--confirm-project",
  "--class-id",
  "--professor-id",
  "--admin-id",
  "--materials-dir",
  "--supabase-url",
]);

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function isSha256(value) {
  return typeof value === "string" && SHA256_RE.test(value);
}

function nonBlank(value, field, max = 100_000) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    fail(`Invalid ${field}.`);
  }
  return value;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isWebp(bytes) {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function safeRelativeFile(rootDir, relativeFile, field) {
  if (typeof relativeFile !== "string" || relativeFile.includes("\0") || path.isAbsolute(relativeFile)) {
    fail(`Invalid ${field}.`);
  }
  const normalized = relativeFile.replaceAll("\\", "/");
  const candidate = path.resolve(rootDir, ...normalized.split("/"));
  let resolved;
  try {
    resolved = fs.realpathSync.native(candidate);
  } catch {
    fail(`${field} is missing.`);
  }
  const relative = path.relative(rootDir, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${field} escapes the materials directory.`);
  }
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) fail(`${field} is not a file.`);
  return resolved;
}

function requireArray(value, field, max = 10_000) {
  if (!Array.isArray(value) || value.length > max) fail(`Invalid ${field}.`);
  return value;
}

function validatePhase(phase, caseId, index) {
  if (!isObject(phase)) fail(`Invalid phase ${index + 1}.`);
  if (!isUuid(phase.id) || phase.caseId !== caseId || !Number.isInteger(phase.order) || phase.order !== index + 1) {
    fail(`Invalid phase identity for case ${caseId}.`);
  }
  nonBlank(phase.title, "phase title", 160);
  nonBlank(phase.goal, "phase goal", 1_500);
  const rubric = requireArray(phase.rubric, "phase rubric", 32);
  const exampleQuestions = requireArray(phase.exampleQuestions, "phase example questions", 32);
  rubric.forEach((item) => nonBlank(item, "phase rubric item", 500));
  nonBlank(phase.starterQuestion, "phase starter question", 1_500);
  exampleQuestions.forEach((item) => nonBlank(item, "phase example question", 1_500));
  if (phase.tutorGuidance !== undefined) {
    requireArray(phase.tutorGuidance, "phase tutor guidance", 32).forEach((item) => nonBlank(item, "phase tutor guidance item", 1_500));
  }
  if (phase.tutorMoves !== undefined) {
    requireArray(phase.tutorMoves, "phase tutor moves", 64);
  }
}

function validateCaseEntry(entry, caseIndex) {
  if (!isObject(entry) || !isObject(entry.case)) fail(`Invalid case ${caseIndex + 1}.`);
  const candidate = entry.case;
  if (!isUuid(candidate.id)) fail(`Invalid case id at index ${caseIndex + 1}.`);
  nonBlank(candidate.title, "case title", 160);
  nonBlank(candidate.description, "case description", 1_500);
  if (!["foundation", "intermediate", "advanced"].includes(candidate.difficulty)) fail(`Invalid difficulty for case ${candidate.id}.`);
  const objectives = requireArray(candidate.learningObjectives, "case learning objectives", 32);
  if (objectives.length === 0) fail(`Case ${candidate.id} needs learning objectives.`);
  objectives.forEach((item) => nonBlank(item, "learning objective", 500));
  const phases = requireArray(candidate.phases, "case phases", 12);
  if (phases.length === 0) fail(`Case ${candidate.id} needs phases.`);
  const phaseIds = new Set();
  phases.forEach((phase, index) => {
    validatePhase(phase, candidate.id, index);
    const phaseId = phase.id.toLowerCase();
    if (phaseIds.has(phaseId)) fail(`Case ${candidate.id} contains duplicate phases.`);
    phaseIds.add(phaseId);
  });
  const attachments = requireArray(candidate.attachments ?? [], "case attachments", 12);
  const attachmentIds = new Set();
  for (const attachment of attachments) {
    if (!isObject(attachment) || !isUuid(attachment.id) || attachment.kind !== "image") {
      fail(`Case ${candidate.id} contains an invalid media attachment.`);
    }
    if (attachmentIds.has(attachment.id.toLowerCase())) fail(`Case ${candidate.id} contains duplicate media attachments.`);
    attachmentIds.add(attachment.id.toLowerCase());
    nonBlank(attachment.title, "attachment title", 500);
    nonBlank(attachment.description, "attachment description", 2_000);
    if (attachment.url !== undefined) nonBlank(attachment.url, "attachment URL", 2_000);
  }
  nonBlank(entry.expertNotes, "case expert notes");
  nonBlank(entry.sourceDocument, "case source document", 500);
  return { ...candidate, id: candidate.id.toLowerCase(), attachments: attachments.map((item) => ({ ...item, id: item.id.toLowerCase() })) };
}

function validateArticle(article, index, knownCaseIds) {
  if (!isObject(article)) fail(`Invalid article ${index + 1}.`);
  nonBlank(article.id, "article id", 200);
  nonBlank(article.title, "article title", 500);
  nonBlank(article.filename, "article filename", 500);
  if (article.filename.includes("\\") || article.filename.split("/").some((part) => !part || part === "." || part === "..")) fail("Article filename is unsafe.");
  if (!isSha256(article.sha256)) fail(`Invalid article hash for ${article.id}.`);
  if (article.sourceType !== undefined
    && article.sourceType !== "published_literature"
    && article.sourceType !== "expert_interview") {
    fail(`Invalid article source type for ${article.id}.`);
  }
  const pages = requireArray(article.pages, "article pages", 20_000);
  if (article.sourceType === "expert_interview" && pages.length === 0) {
    fail(`Expert interview ${article.id} has no pages.`);
  }
  const normalizedPages = pages.map((page, pageIndex) => {
    if (!isObject(page) || !Number.isInteger(page.page) || page.page <= 0) fail(`Invalid page for article ${article.id}.`);
    nonBlank(page.text, "article page text", 50_000);
    if (page.locator !== undefined) nonBlank(page.locator, "article page locator", 800);
    if (page.expert !== undefined) nonBlank(page.expert, "article page expert", 120);
    if (page.section !== undefined) nonBlank(page.section, "article page section", 500);
    let normalizedCaseIds;
    if (page.caseIds !== undefined) {
      const scopedCaseIds = requireArray(page.caseIds, "article page case ids", 500);
      if (scopedCaseIds.length === 0) fail(`Article ${article.id} page ${pageIndex + 1} has an empty case scope.`);
      const seenCaseIds = new Set();
      normalizedCaseIds = scopedCaseIds.map((caseId) => {
        if (!isUuid(caseId)) fail(`Invalid case scope for article ${article.id}.`);
        const normalized = caseId.toLowerCase();
        if (seenCaseIds.has(normalized)) fail(`Duplicate case scope for article ${article.id}.`);
        if (!knownCaseIds.has(normalized)) fail(`Article ${article.id} references an unknown case.`);
        seenCaseIds.add(normalized);
        return normalized;
      });
    }
    if (article.sourceType === "expert_interview" && (!page.locator || !page.expert)) {
      fail(`Expert interview ${article.id} pages require a locator and expert attribution.`);
    }
    return normalizedCaseIds ? { ...page, caseIds: normalizedCaseIds } : { ...page };
  });
  return { ...article, pages: normalizedPages };
}

/**
 * Validate the imported manifest and all referenced media without contacting
 * Supabase. This is exported so the synthetic tests can exercise the same
 * safety boundary as the CLI.
 */
export function validateManifest(raw, materialsDir) {
  if (!isObject(raw) || raw.formatVersion !== 1 || typeof raw.packageId !== "string" || !PACKAGE_RE.test(raw.packageId)) {
    fail("Manifest format or package id is invalid.");
  }
  const packageId = raw.packageId;
  const casesRaw = requireArray(raw.cases, "manifest cases", 500);
  const articles = requireArray(raw.articles, "manifest articles", 500);
  const media = requireArray(raw.media, "manifest media", 5_000);
  if (casesRaw.length === 0) fail("Manifest has no cases.");
  const rootDir = fs.realpathSync.native(materialsDir);
  if (!fs.statSync(rootDir).isDirectory()) fail("Materials directory is not a directory.");
  const cases = casesRaw.map((entry, index) => {
    const candidate = validateCaseEntry(entry, index);
    return {
      case: candidate,
      expertNotes: entry.expertNotes,
      sourceDocument: entry.sourceDocument,
    };
  });
  const caseIds = new Set();
  for (const entry of cases) {
    if (caseIds.has(entry.case.id)) fail(`Duplicate case ${entry.case.id}.`);
    caseIds.add(entry.case.id);
  }
  const articleIds = new Set();
  const validatedArticles = articles.map((article, index) => {
    const validated = validateArticle(article, index, caseIds);
    if (articleIds.has(validated.id)) fail(`Duplicate article ${validated.id}.`);
    articleIds.add(validated.id);
    return validated;
  });

  const mediaIds = new Set();
  const mediaById = new Map();
  for (const item of media) {
    if (!isObject(item) || !isUuid(item.id) || !isUuid(item.caseId) || !MEDIA_FILE_RE.test(item.file) || item.mimeType !== "image/webp") {
      fail("Manifest media entry is invalid.");
    }
    const id = item.id.toLowerCase();
    const caseId = item.caseId.toLowerCase();
    if (!caseIds.has(caseId) || mediaIds.has(id) || item.file.toLowerCase() !== `media/${id}.webp`) fail(`Manifest media mapping is invalid for ${id}.`);
    if (!isSha256(item.sha256) || !Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width <= 0 || item.height <= 0 || item.width > 40_000 || item.height > 40_000) {
      fail(`Manifest media metadata is invalid for ${id}.`);
    }
    const absoluteFile = safeRelativeFile(rootDir, item.file, `Media ${id}`);
    const bytes = fs.readFileSync(absoluteFile);
    if (bytes.length > MAX_MEDIA_BYTES || !isWebp(bytes) || sha256(bytes) !== item.sha256.toLowerCase()) {
      fail(`Media ${id} failed its WebP or hash check.`);
    }
    const normalized = { ...item, id, caseId, file: item.file.replaceAll("\\", "/").toLowerCase(), sha256: item.sha256.toLowerCase(), absoluteFile };
    mediaIds.add(id);
    mediaById.set(id, normalized);
  }

  const attachmentIds = new Set();
  for (const entry of cases) {
    for (const attachment of entry.case.attachments ?? []) {
      const id = attachment.id.toLowerCase();
      if (attachmentIds.has(id) || !mediaById.has(id) || mediaById.get(id).caseId !== entry.case.id) fail(`Attachment ${id} is not registered to its case.`);
      attachmentIds.add(id);
    }
  }
  if (attachmentIds.size !== mediaIds.size) fail("Manifest contains unregistered media or attachments.");
  return { formatVersion: 1, packageId, cases, articles: validatedArticles, media: [...mediaById.values()], rootDir };
}

function getProjectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co(?:m)?$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function publicMediaUrl(supabaseUrl, objectPath) {
  let baseUrl;
  try {
    baseUrl = new URL(supabaseUrl);
  } catch {
    fail("Supabase URL is invalid.");
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) {
    fail("Supabase URL must use HTTPS without embedded credentials.");
  }
  baseUrl.search = "";
  baseUrl.hash = "";
  const prefix = baseUrl.toString().replace(/\/+$/, "");
  return `${prefix}/storage/v1/object/public/${PUBLIC_BUCKET}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

function buildCaseRow(candidate, packageId, adminId, supabaseUrl) {
  const attachments = (candidate.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    kind: "image",
    title: attachment.title,
    description: attachment.description,
    url: publicMediaUrl(supabaseUrl, PUBLIC_MEDIA_PATH(packageId, attachment.id)),
    // The URL itself is the published asset. Do not copy an unverified source
    // citation from the import into a public case attachment.
    sourceLabel: "User-supplied teaching case (authorized publication)",
    sourceUrl: publicMediaUrl(supabaseUrl, PUBLIC_MEDIA_PATH(packageId, attachment.id)),
  }));
  return {
    id: candidate.id,
    slug: `teaching-${packageId.slice(0, 16)}-${candidate.id}`,
    title: candidate.title,
    specialty: "dentistry",
    diagnosis: null,
    presenting_complaint: candidate.description,
    status: "draft",
    patient_context: { teachingMaterialPackageId: packageId },
    tags: candidate.learningObjectives,
    created_by: adminId,
    source_case_id: null,
    version: 1,
    published_at: null,
    attachments,
  };
}

function buildPhaseRows(candidate) {
  return candidate.phases.map((phase) => ({
    id: phase.id,
    case_id: candidate.id,
    phase_order: phase.order,
    phase_key: `phase_${phase.order}`,
    title: phase.title,
    objectives: [phase.goal, ...phase.rubric],
    questions: [phase.starterQuestion, ...phase.exampleQuestions],
    teaching_notes: null,
    expected_findings: {},
    metadata: {
      rubric: phase.rubric,
      tutorGuidance: phase.tutorGuidance ?? [],
      tutorMoves: phase.tutorMoves ?? [],
    },
  }));
}

export function buildPublicationPlan({ manifest, supabaseUrl, classId, professorId, adminId, publish = false }) {
  if (!manifest?.packageId || !supabaseUrl) fail("Manifest and Supabase URL are required.");
  const cases = manifest.cases.map((entry) => ({
    case: buildCaseRow(entry.case, manifest.packageId, adminId, supabaseUrl),
    phases: buildPhaseRows(entry.case),
  }));
  const assignments = publish
    ? cases.map(({ case: candidate }) => ({
      class_id: classId,
      case_id: candidate.id,
      assigned_by: professorId,
      status: "open",
      opens_at: "<execution-time>",
      due_at: null,
      idempotency_key: `materials:${manifest.packageId}:${classId}:${candidate.id}`,
    }))
    : [];
  return {
    packageId: manifest.packageId,
    caseIds: cases.map(({ case: candidate }) => candidate.id),
    mediaIds: manifest.media.map((item) => item.id),
    articleCount: manifest.articles.length,
    cases,
    assignments,
    privateManifestPath: PRIVATE_MANIFEST_PATH(manifest.packageId),
    publicMediaPaths: manifest.media.map((item) => PUBLIC_MEDIA_PATH(manifest.packageId, item.id)),
  };
}

/**
 * Build the private object uploaded to Storage. Keep the validated article
 * and page metadata intact so provenance (including interview attribution and
 * paragraph locators) remains available to the server-side retriever. Local
 * filesystem paths are the only fields removed from this object.
 */
export function buildPrivateManifestPayload(manifest) {
  return {
    formatVersion: manifest.formatVersion,
    packageId: manifest.packageId,
    cases: manifest.cases,
    articles: manifest.articles.map((article) => ({
      ...article,
      pages: article.pages.map((page) => ({ ...page })),
    })),
    media: manifest.media.map((item) => {
      const copy = { ...item };
      delete copy.absoluteFile;
      return copy;
    }),
  };
}

function parseArgs(argv) {
  const result = { apply: false, publish: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else if (argument === "--apply") {
      result.apply = true;
    } else if (argument === "--publish") {
      result.publish = true;
    } else if (VALUE_FLAGS.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value.`);
      result[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (argument === "--dry-run") {
      result.apply = false;
    } else {
      fail(`Unknown argument ${argument}.`);
    }
  }
  if (result.publish && !result.apply) fail("--publish requires --apply.");
  if (!result.materials_dir) result.materials_dir = "work/teaching-materials";
  if (result.apply) {
    for (const name of ["confirm_project", "class_id", "professor_id", "admin_id", "materials_dir"]) {
      if (!result[name]) fail(`--apply requires --${name.replaceAll("_", "-")}.`);
    }
    for (const name of ["class_id", "professor_id", "admin_id"]) if (!isUuid(result[name])) fail(`Invalid --${name.replaceAll("_", "-")}.`);
  }
  return result;
}

function printHelp() {
  process.stdout.write(`Publish imported teaching materials (dry-run by default).\n\n` +
    `node --env-file=.env.local scripts/publish-teaching-materials.mjs [options]\n\n` +
    `Required for writes:\n` +
    `  --apply --confirm-project <ref> --class-id <uuid> --professor-id <uuid>\n` +
    `  --admin-id <uuid> --materials-dir <path>\n\n` +
    `Optional:\n` +
    `  --publish       activate cases and create idempotent open assignments\n` +
    `  --dry-run       validate and print the bounded plan (the default)\n` +
    `  --supabase-url  override SUPABASE_URL (normally use the environment)\n`);
}

function loadManifestFromDisk(materialsDir) {
  const resolvedRoot = fs.realpathSync.native(path.resolve(materialsDir));
  const manifestPath = safeRelativeFile(resolvedRoot, "manifest.json", "Manifest");
  const stats = fs.statSync(manifestPath);
  if (stats.size > MAX_MANIFEST_BYTES) fail("Manifest is too large.");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    fail("Manifest JSON is invalid.");
  }
  return validateManifest(raw, resolvedRoot);
}

function summarize(manifest, plan, apply) {
  return {
    mode: apply ? "apply" : "dry-run",
    publish: Boolean(plan.assignments.length),
    packageId: manifest.packageId,
    caseIds: plan.caseIds,
    cases: plan.caseIds.length,
    media: plan.mediaIds.length,
    articles: plan.articleCount,
    privateManifest: plan.privateManifestPath,
    assignments: plan.assignments.length,
    writes: apply ? "enabled only after project/actor preflight" : "none",
  };
}

function isConflict(error) {
  return error?.code === "23505" || /already exists|duplicate|conflict/i.test(error?.message ?? "");
}

async function readOne(client, table, id) {
  const { data, error } = await client.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Read ${table} failed.`);
  return data;
}

async function ensureActors(client, options) {
  const classRow = await readOne(client, "classes", options.classId);
  if (!classRow || classRow.status !== "active") fail("Target class is not active.");
  const professor = await readOne(client, "users", options.professorId);
  if (!professor || professor.role !== "professor" || professor.is_active === false) fail("Target professor is not active.");
  const admin = await readOne(client, "users", options.adminId);
  if (!admin || admin.role !== "admin" || admin.is_active === false) fail("Target admin is not active.");
  const { data: membership, error: membershipError } = await client
    .from("class_memberships")
    .select("class_id,user_id,role")
    .eq("class_id", options.classId)
    .eq("user_id", options.professorId)
    .eq("role", "professor")
    .maybeSingle();
  if (membershipError) throw new Error("Check professor class membership failed.");
  if (!membership) fail("Target professor is not a member of the target class.");
}

async function ensureBuckets(client) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) throw new Error("List Supabase Storage buckets failed.");
  const required = [
    { name: PRIVATE_BUCKET, public: false, allowedMimeTypes: ["application/json"], fileSizeLimit: "16MB" },
    { name: PUBLIC_BUCKET, public: true, allowedMimeTypes: ["image/webp"], fileSizeLimit: "10MB" },
  ];
  for (const desired of required) {
    const current = (buckets ?? []).find((bucket) => bucket.id === desired.name || bucket.name === desired.name);
    if (!current) {
      const { error: createError } = await client.storage.createBucket(desired.name, {
        public: desired.public,
        allowedMimeTypes: desired.allowedMimeTypes,
        fileSizeLimit: desired.fileSizeLimit,
      });
      if (createError && !isConflict(createError)) throw new Error(`Create storage bucket ${desired.name} failed.`);
      continue;
    }
    if (Boolean(current.public) !== desired.public) fail(`Storage bucket ${desired.name} has unsafe visibility.`);
    const allowed = current.allowed_mime_types ?? current.allowedMimeTypes;
    if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(desired.allowedMimeTypes[0]) && !allowed.includes("image/*")) {
      fail(`Storage bucket ${desired.name} has incompatible MIME restrictions.`);
    }
  }
}

export function isMissingStorageObjectError(error) {
  if (!error || typeof error !== "object") return false;
  const statusCode = Number(error.statusCode);
  const status = Number(error.status);
  if (statusCode === 404 || status === 404) return true;
  return [error.code, error.name].some((value) => /^(?:404|not[_-]?found)$/i.test(String(value ?? "")));
}

export async function uploadIfMissing(client, bucket, objectPath, bytes, contentType) {
  const bucketClient = client.storage.from(bucket);
  // Storage's `exists()` endpoint can return a 400 for a missing object on
  // some deployments. Use the object download as the authoritative read so
  // only an explicit 404/NotFound response permits a first upload.
  const { data, error } = await bucketClient.download(objectPath);
  if (!error && data) {
    const existing = Buffer.from(await data.arrayBuffer());
    if (sha256(existing) !== sha256(bytes)) throw new Error(`Existing storage object ${bucket}/${objectPath} differs; refusing overwrite.`);
    return "existing";
  }
  if (error && !isMissingStorageObjectError(error)) throw new Error(`Check storage object ${bucket}/${objectPath} failed.`);
  if (!data && !error) throw new Error(`Read existing storage object ${bucket}/${objectPath} failed.`);
  const { error: uploadError } = await bucketClient.upload(objectPath, bytes, { contentType, cacheControl: "31536000", upsert: false });
  if (uploadError && !isConflict(uploadError)) throw new Error(`Upload storage object ${bucket}/${objectPath} failed.`);
  if (uploadError) {
    const { data, error } = await bucketClient.download(objectPath);
    if (error || !data) throw new Error(`Verify raced storage object ${bucket}/${objectPath} failed.`);
    const existing = Buffer.from(await data.arrayBuffer());
    if (sha256(existing) !== sha256(bytes)) throw new Error(`Raced storage object ${bucket}/${objectPath} differs; refusing overwrite.`);
    return "existing";
  }
  return "uploaded";
}

function canonicalCase(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    specialty: row.specialty,
    diagnosis: row.diagnosis ?? null,
    presenting_complaint: row.presenting_complaint ?? null,
    patient_context: row.patient_context ?? {},
    tags: row.tags ?? [],
    created_by: row.created_by,
    source_case_id: row.source_case_id ?? null,
    version: row.version ?? 1,
    attachments: row.attachments ?? [],
  };
}

function canonicalPhase(row) {
  return {
    id: row.id,
    case_id: row.case_id,
    phase_order: row.phase_order,
    phase_key: row.phase_key,
    title: row.title,
    objectives: row.objectives ?? [],
    questions: row.questions ?? [],
    teaching_notes: row.teaching_notes ?? null,
    expected_findings: row.expected_findings ?? {},
    metadata: row.metadata ?? {},
  };
}

function assertCaseMatches(existing, expected) {
  if (existing.patient_context?.teachingMaterialPackageId !== expected.patient_context.teachingMaterialPackageId) {
    fail(`Existing case ${expected.id} is not owned by this materials package.`);
  }
  if (stableStringify(canonicalCase(existing)) !== stableStringify(canonicalCase(expected))) {
    fail(`Existing case ${expected.id} differs; refusing to overwrite learning data.`);
  }
  if (existing.status === "archived") fail(`Existing case ${expected.id} is archived; refusing to unarchive it.`);
  if (existing.status === "draft" && existing.published_at) fail(`Existing draft ${expected.id} has an inconsistent publication timestamp.`);
}

function assertPhaseRowsCompatible(existingRows, expectedRows, caseId) {
  if (existingRows.length > expectedRows.length) fail(`Existing phases for ${caseId} differ; refusing to delete or overwrite them.`);
  const expectedById = new Map(expectedRows.map((row) => [row.id, row]));
  for (const existing of existingRows) {
    const expected = expectedById.get(existing.id);
    if (!expected || stableStringify(canonicalPhase(existing)) !== stableStringify(canonicalPhase(expected))) {
      fail(`Existing phase ${existing.id} differs; refusing to overwrite learning data.`);
    }
  }
}

function assertPhasesMatch(existingRows, expectedRows, caseId) {
  if (existingRows.length !== expectedRows.length) fail(`Existing phases for ${caseId} differ; refusing to delete or overwrite them.`);
  assertPhaseRowsCompatible(existingRows, expectedRows, caseId);
}

async function ensureDraftRows(client, plan) {
  const caseIds = plan.caseIds;
  const { data: existingCases, error: caseError } = await client.from("cases").select("*").in("id", caseIds);
  if (caseError) throw new Error("Read existing teaching cases failed.");
  const casesById = new Map((existingCases ?? []).map((row) => [row.id, row]));
  const { data: existingPhases, error: phaseError } = await client.from("case_phases").select("*").in("case_id", caseIds);
  if (phaseError) throw new Error("Read existing teaching phases failed.");
  const phasesByCase = new Map();
  for (const row of existingPhases ?? []) phasesByCase.set(row.case_id, [...(phasesByCase.get(row.case_id) ?? []), row]);

  for (const item of plan.cases) {
    const existing = casesById.get(item.case.id);
    if (existing) {
      assertCaseMatches(existing, item.case);
    } else {
      const { error } = await client.from("cases").insert(item.case);
      if (error && !isConflict(error)) throw new Error(`Insert teaching case ${item.case.id} failed.`);
      const reread = await readOne(client, "cases", item.case.id);
      if (!reread) fail(`Inserted case ${item.case.id} could not be verified.`);
      assertCaseMatches(reread, item.case);
      casesById.set(item.case.id, reread);
    }
    const existingCasePhases = phasesByCase.get(item.case.id) ?? [];
    if (existingCasePhases.length > 0) {
      // A process can be interrupted after a draft case and only some of its
      // phases have been inserted. Resume that draft by inserting only the
      // missing immutable rows; published or content-mismatched rows never
      // get repaired in place.
      assertPhaseRowsCompatible(existingCasePhases, item.phases, item.case.id);
      if (existingCasePhases.length < item.phases.length) {
        if (existing && existing.status !== "draft") {
          fail(`Published case ${item.case.id} has incomplete phases; refusing to repair or modify it.`);
        }
        const existingIds = new Set(existingCasePhases.map((row) => row.id));
        const missing = item.phases.filter((phase) => !existingIds.has(phase.id));
        const { error } = await client.from("case_phases").insert(missing);
        if (error && !isConflict(error)) throw new Error(`Insert teaching phases for ${item.case.id} failed.`);
        const { data: reread, error: rereadError } = await client.from("case_phases").select("*").eq("case_id", item.case.id);
        if (rereadError) throw new Error(`Verify teaching phases for ${item.case.id} failed.`);
        assertPhasesMatch(reread ?? [], item.phases, item.case.id);
        phasesByCase.set(item.case.id, reread ?? []);
      }
    } else {
      if (existing && existing.status !== "draft") {
        fail(`Published case ${item.case.id} has no phases; refusing to repair or modify it.`);
      }
      const { error } = await client.from("case_phases").insert(item.phases);
      if (error && !isConflict(error)) throw new Error(`Insert teaching phases for ${item.case.id} failed.`);
      const { data: reread, error: rereadError } = await client.from("case_phases").select("*").eq("case_id", item.case.id);
      if (rereadError) throw new Error(`Verify teaching phases for ${item.case.id} failed.`);
      assertPhasesMatch(reread ?? [], item.phases, item.case.id);
      phasesByCase.set(item.case.id, reread ?? []);
    }
  }
  return { casesById, phasesByCase };
}

async function ensureAssignmentsReady(client, plan, classId, professorId) {
  if (!plan.assignments.length) return new Map();
  const keys = plan.assignments.map((item) => item.idempotency_key);
  const { data, error } = await client.from("class_case_assignments").select("*").in("idempotency_key", keys);
  if (error) throw new Error("Read existing teaching assignments failed.");
  const byKey = new Map((data ?? []).map((row) => [row.idempotency_key, row]));
  for (const expected of plan.assignments) {
    const existing = byKey.get(expected.idempotency_key);
    if (!existing) continue;
    if (existing.class_id !== classId || existing.case_id !== expected.case_id || existing.assigned_by !== professorId || existing.status !== "open") {
      fail(`Existing assignment ${expected.idempotency_key} differs or is not open; refusing to overwrite it.`);
    }
  }
  return byKey;
}

async function activateCases(client, plan) {
  const publishedAt = new Date().toISOString();
  for (const item of plan.cases) {
    const current = await readOne(client, "cases", item.case.id);
    if (!current) fail(`Case ${item.case.id} disappeared before activation.`);
    assertCaseMatches(current, item.case);
    if (current.status === "draft") {
      const { error } = await client.from("cases").update({ status: "active", published_at: publishedAt }).eq("id", item.case.id).eq("status", "draft");
      if (error) throw new Error(`Activate case ${item.case.id} failed.`);
    } else if (current.status !== "active") {
      fail(`Case ${item.case.id} is not publishable.`);
    }
  }
  const { data, error } = await client.from("cases").select("id,status,published_at").in("id", plan.caseIds);
  if (error) throw new Error("Verify published cases failed.");
  if ((data ?? []).length !== plan.caseIds.length) fail("Published case verification returned an incomplete set.");
  for (const row of data ?? []) if (row.status !== "active" || !row.published_at) fail(`Case ${row.id} did not activate.`);
}

async function createAssignments(client, plan, professorId) {
  const now = new Date().toISOString();
  for (const template of plan.assignments) {
    const expected = { ...template, assigned_by: professorId, opens_at: now };
    const { data: existing, error: readError } = await client.from("class_case_assignments").select("*").eq("idempotency_key", template.idempotency_key).maybeSingle();
    if (readError) throw new Error("Read assignment idempotency key failed.");
    if (existing) {
      if (existing.class_id !== expected.class_id || existing.case_id !== expected.case_id || existing.assigned_by !== expected.assigned_by || existing.status !== "open") fail(`Existing assignment ${template.idempotency_key} differs; refusing overwrite.`);
      continue;
    }
    const { error } = await client.from("class_case_assignments").insert(expected);
    if (error && !isConflict(error)) throw new Error(`Create assignment ${template.idempotency_key} failed.`);
    const reread = await client.from("class_case_assignments").select("*").eq("idempotency_key", template.idempotency_key).maybeSingle();
    if (reread.error || !reread.data) throw new Error(`Verify assignment ${template.idempotency_key} failed.`);
    if (reread.data.class_id !== expected.class_id || reread.data.case_id !== expected.case_id || reread.data.assigned_by !== expected.assigned_by || reread.data.status !== "open") {
      fail(`Assignment ${template.idempotency_key} raced with different data.`);
    }
  }
}

async function applyPlan(manifest, plan, options) {
  const supabaseUrl = options.supabase_url || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
  const projectRef = getProjectRef(supabaseUrl);
  if (!projectRef || projectRef !== options.confirm_project) fail("--confirm-project does not match SUPABASE_URL.");
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await ensureActors(client, { classId: options.class_id, professorId: options.professor_id, adminId: options.admin_id });
  await ensureBuckets(client);

  // `rootDir` and `absoluteFile` are local implementation details and must
  // never be serialized into the private reference manifest.
  const manifestForUpload = buildPrivateManifestPayload(manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifestForUpload, null, 2));
  const storageResults = { references: await uploadIfMissing(client, PRIVATE_BUCKET, plan.privateManifestPath, manifestBytes, "application/json"), mediaUploaded: 0, mediaExisting: 0 };
  for (const item of manifest.media) {
    const bytes = fs.readFileSync(item.absoluteFile);
    const result = await uploadIfMissing(client, PUBLIC_BUCKET, PUBLIC_MEDIA_PATH(manifest.packageId, item.id), bytes, "image/webp");
    if (result === "uploaded") storageResults.mediaUploaded += 1;
    else storageResults.mediaExisting += 1;
  }
  await ensureDraftRows(client, plan);
  if (options.publish) {
    await ensureAssignmentsReady(client, plan, options.class_id, options.professor_id);
    await activateCases(client, plan);
    await createAssignments(client, plan, options.professor_id);
  }
  return storageResults;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { help: true };
  }
  const manifest = loadManifestFromDisk(options.materials_dir);
  const supabaseUrl = options.supabase_url || process.env.SUPABASE_URL || "https://example.supabase.co";
  const plan = buildPublicationPlan({
    manifest,
    supabaseUrl,
    classId: options.class_id || "00000000-0000-4000-8000-000000000000",
    professorId: options.professor_id || "00000000-0000-4000-8000-000000000000",
    adminId: options.admin_id || "00000000-0000-4000-8000-000000000000",
    publish: options.publish,
  });
  process.stdout.write(`${JSON.stringify(summarize(manifest, plan, options.apply), null, 2)}\n`);
  if (!options.apply) return { manifest, plan, options };
  const result = await applyPlan(manifest, plan, options);
  process.stdout.write(`${JSON.stringify({ applied: true, ...result }, null, 2)}\n`);
  return { manifest, plan, options, result };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Publication failed."}\n`);
    process.exitCode = 1;
  });
}
