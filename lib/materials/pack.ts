import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { CaseAttachment, CasePhase, ClinicalCase } from "@/lib/domain";
import { caseInputSchema } from "@/lib/schemas";

/** A page of text from one source article in the private local pack. */
export interface MaterialArticlePage {
  page: number;
  text: string;
}

export interface MaterialArticle {
  id: string;
  title: string;
  filename: string;
  sha256: string;
  pages: MaterialArticlePage[];
}

export interface MaterialMedia {
  id: string;
  caseId: string;
  file: string;
  mimeType: "image/webp";
  sha256: string;
  width: number;
  height: number;
}

export interface MaterialCaseEntry {
  /** The public case. Expert notes intentionally live beside it, never inside it. */
  case: ClinicalCase;
  expertNotes: string;
  sourceDocument: string;
}

export interface MaterialPack {
  formatVersion: 1;
  packageId: string;
  cases: MaterialCaseEntry[];
  articles: MaterialArticle[];
  media: MaterialMedia[];
  /** Internal server-only root. It is not part of the manifest or any API response. */
  readonly rootDir: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const UUID_WEBP = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

const articlePageSchema = z.object({
  page: z.number().int().positive().max(20_000),
  text: z.string().max(50_000),
}).strict();

const safeArticleFilename = z.string().trim().min(1).max(500).refine((value) => {
  if (value.includes("\0") || value.includes("\\")) return false;
  if (path.posix.isAbsolute(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}, "Article filenames must be relative and cannot traverse directories.");

const articleSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  filename: safeArticleFilename,
  sha256: z.string().regex(SHA256),
  pages: z.array(articlePageSchema).max(20_000),
}).strict();

const mediaSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  file: z.string().regex(UUID_WEBP, "Media files must be media/<uuid>.webp."),
  mimeType: z.literal("image/webp"),
  sha256: z.string().regex(SHA256),
  width: z.number().int().positive().max(40_000),
  height: z.number().int().positive().max(40_000),
}).strict();

const rawManifestSchema = z.object({
  formatVersion: z.literal(1),
  packageId: z.string().trim().min(1).max(200),
  cases: z.array(z.unknown()).max(500),
  articles: z.array(articleSchema).max(500),
  media: z.array(mediaSchema).max(5_000),
}).strict();

interface RawManifestCase {
  case: unknown;
  expertNotes: unknown;
  sourceDocument: unknown;
}

const rawManifestCaseSchema = z.object({
  case: z.unknown(),
  expertNotes: z.string().max(100_000),
  sourceDocument: z.string().trim().min(1).max(500),
}).strict();

let cachedPack: { rootDir: string; value: MaterialPack | null } | null = null;

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32).split("");
  // UUID version 5 and RFC 4122 variant bits keep generated IDs valid UUIDs.
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

function isContained(rootDir: string, candidate: string): boolean {
  const relative = path.relative(rootDir, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function realDirectory(configured: string): string | null {
  if (!path.isAbsolute(configured) || configured.includes("\0")) return null;
  try {
    const resolved = fs.realpathSync.native(configured);
    const stats = fs.statSync(resolved);
    return stats.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function configuredRoot(): string | null {
  const configured = process.env.TUTOR_MATERIALS_DIR?.trim();
  if (!configured) return null;
  // This pack is deliberately local-only. Vercel must never read a path from
  // an environment variable and accidentally serve private source material.
  if (process.env.FORCE_MEMORY_REPOSITORY !== "true" || process.env.VERCEL) {
    throw new Error("Local teaching materials are disabled in this environment.");
  }
  if (!path.isAbsolute(configured) || configured.includes("\0")) {
    throw new Error("Local teaching materials directory is unsafe.");
  }
  const resolved = realDirectory(configured);
  if (!resolved) throw new Error("Local teaching materials directory is unavailable.");
  return resolved;
}

function reconstructCase(value: unknown, packageId: string): ClinicalCase | null {
  const parsed = caseInputSchema.safeParse(value);
  if (!parsed.success || !parsed.data.id) return null;

  const caseId = parsed.data.id.toLowerCase();
  const phases: CasePhase[] = parsed.data.phases.map((phase) => ({
    ...phase,
    id: phase.id ?? stableUuid(`${packageId}:${caseId}:phase:${phase.order}`),
    caseId,
  }));

  const attachments: CaseAttachment[] = parsed.data.attachments.map((attachment, attachmentIndex) => ({
    ...attachment,
    id: attachment.id ?? stableUuid(`${packageId}:${caseId}:attachment:${attachmentIndex}:${attachment.title}`),
  }));

  // Status, version and lineage are controlled by the local pack loader. Any
  // similarly named fields in the imported JSON are ignored by caseInputSchema.
  return {
    ...parsed.data,
    id: caseId,
    status: "available",
    version: 1,
    sourceCaseId: null,
    publishedAt: null,
    phases,
    attachments,
    isTestFixture: false,
  };
}

function loadPack(rootDir: string): MaterialPack | null {
  const manifestPath = path.join(rootDir, "manifest.json");
  let manifestRealPath: string;
  try {
    manifestRealPath = fs.realpathSync.native(manifestPath);
  } catch {
    throw new Error("Local teaching materials manifest is unavailable.");
  }
  if (!isContained(rootDir, manifestRealPath)) throw new Error("Local teaching materials manifest is unsafe.");

  let raw: unknown;
  try {
    const stats = fs.statSync(manifestRealPath);
    if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) throw new Error("manifest-size");
    raw = JSON.parse(fs.readFileSync(manifestRealPath, "utf8"));
  } catch {
    throw new Error("Local teaching materials manifest is invalid.");
  }
  const envelope = rawManifestSchema.safeParse(raw);
  if (!envelope.success) throw new Error("Local teaching materials manifest is invalid.");

  const cases: MaterialCaseEntry[] = [];
  const caseIds = new Set<string>();
  for (const candidate of envelope.data.cases) {
    const rawCase = rawManifestCaseSchema.safeParse(candidate as RawManifestCase);
    if (!rawCase.success) throw new Error("Local teaching materials case is invalid.");
    const clinicalCase = reconstructCase(rawCase.data.case, envelope.data.packageId);
    if (!clinicalCase || caseIds.has(clinicalCase.id)) throw new Error("Local teaching materials cases are invalid.");
    caseIds.add(clinicalCase.id);
    cases.push({
      case: clinicalCase,
      expertNotes: rawCase.data.expertNotes,
      sourceDocument: rawCase.data.sourceDocument,
    });
  }

  const articles = envelope.data.articles.map((article) => ({ ...article, pages: article.pages.map((page) => ({ ...page })) }));
  const articleIds = new Set<string>();
  for (const article of articles) {
    if (articleIds.has(article.id)) throw new Error("Local teaching materials articles are invalid.");
    articleIds.add(article.id);
  }

  const media = envelope.data.media.map((item) => ({
    ...item,
    id: item.id.toLowerCase(),
    caseId: item.caseId.toLowerCase(),
  }));
  const mediaIds = new Set<string>();
  for (const item of media) {
    if (mediaIds.has(item.id) || !caseIds.has(item.caseId.toLowerCase()) || item.file.toLowerCase() !== `media/${item.id.toLowerCase()}.webp`) {
      throw new Error("Local teaching materials media are invalid.");
    }
    mediaIds.add(item.id);
  }

  const pack: MaterialPack = {
    formatVersion: 1,
    packageId: envelope.data.packageId,
    cases,
    articles,
    media,
    rootDir,
  };
  Object.defineProperty(pack, "rootDir", { value: rootDir, enumerable: false, writable: false, configurable: false });
  return pack;
}

/** Load the local teaching pack once per resolved root, or return null when disabled/unavailable. */
export function getMaterialPack(): MaterialPack | null {
  const rootDir = configuredRoot();
  if (!rootDir) {
    cachedPack = null;
    return null;
  }
  if (cachedPack?.rootDir === rootDir) return cachedPack.value;
  const value = loadPack(rootDir);
  cachedPack = { rootDir, value };
  return value;
}
