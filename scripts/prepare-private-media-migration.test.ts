import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRIVATE_MEDIA_BUCKET,
  PUBLIC_MEDIA_BUCKET,
  PUBLIC_MEDIA_PREFIX,
  TUTOR_PROJECT_REF,
  assertTutorProject,
  collectReferencedMedia,
  parseTutorPublicMediaUrl,
  preparePrivateMediaMigration,
} from "./prepare-private-media-migration.mjs";

const SUPABASE_URL = `https://${TUTOR_PROJECT_REF}.supabase.co`;
const MEDIA_KEY = `${"a".repeat(64)}/11111111-1111-4111-8111-111111111111.webp`;
const MEDIA_URL = `${SUPABASE_URL}${PUBLIC_MEDIA_PREFIX}${MEDIA_KEY}`;

function webpBytes(fill = 0x5a) {
  const bytes = Buffer.alloc(24, fill);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  return bytes;
}

function fakeClient(caseRows: unknown[], initialObjects: Record<string, Buffer> = {}, corruptUploadedTarget = false) {
  const objects = new Map<string, Buffer>();
  for (const [key, bytes] of Object.entries(initialObjects)) objects.set(key, Buffer.from(bytes));
  const uploads: Array<{ bucket: string; key: string; bytes: Buffer; options: Record<string, unknown> }> = [];

  const client = {
    from: vi.fn(() => ({
      select: vi.fn(async () => ({ data: caseRows, error: null })),
    })),
    storage: {
      from: vi.fn((bucket: string) => ({
        download: vi.fn(async (key: string) => {
          const bytes = objects.get(`${bucket}/${key}`);
          if (!bytes) return { data: null, error: { status: 404 } };
          return { data: new Blob([new Uint8Array(bytes)], { type: "image/webp" }), error: null };
        }),
        upload: vi.fn(async (key: string, value: Buffer, options: Record<string, unknown>) => {
          const objectKey = `${bucket}/${key}`;
          if (objects.has(objectKey)) return { data: null, error: { status: 409, message: "Already exists" } };
          uploads.push({ bucket, key, bytes: Buffer.from(value), options });
          const stored = corruptUploadedTarget ? Buffer.from("corrupt-upload") : Buffer.from(value);
          objects.set(objectKey, stored);
          return { data: { path: key }, error: null };
        }),
      })),
    },
  };

  return { client, uploads };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("existing private-media preparation", () => {
  it("accepts only the exact tutor public Storage origin and safe WebP key", () => {
    expect(parseTutorPublicMediaUrl(MEDIA_URL, SUPABASE_URL)).toBe(MEDIA_KEY);
    expect(parseTutorPublicMediaUrl(`${MEDIA_URL}?download=1`, SUPABASE_URL)).toBeNull();
    expect(parseTutorPublicMediaUrl(MEDIA_URL.replace(TUTOR_PROJECT_REF, "bbbbbbbbbbbbbbbbbbbb"), SUPABASE_URL)).toBeNull();
    expect(parseTutorPublicMediaUrl(MEDIA_URL.replace(PUBLIC_MEDIA_BUCKET, "other-bucket"), SUPABASE_URL)).toBeNull();
    expect(parseTutorPublicMediaUrl(`${SUPABASE_URL}${PUBLIC_MEDIA_PREFIX}%2e%2e/${MEDIA_KEY}`, SUPABASE_URL)).toBeNull();
    expect(parseTutorPublicMediaUrl(`${SUPABASE_URL}${PUBLIC_MEDIA_PREFIX}unsafe.txt`, SUPABASE_URL)).toBeNull();
    expect(() => assertTutorProject(SUPABASE_URL, TUTOR_PROJECT_REF)).not.toThrow();
    expect(() => assertTutorProject("https://bbbbbbbbbbbbbbbbbbbb.supabase.co", TUTOR_PROJECT_REF)).toThrow(/EXPECTED_SUPABASE_PROJECT_REF/);
  });

  it("deduplicates current and legacy mirror references without reading unrelated URLs", () => {
    const rows = [{
      attachments: [{ id: "attachment-1", url: MEDIA_URL, sourceUrl: "https://doi.org/example" }],
      patient_context: {
        attachments: [{ id: "attachment-1", url: MEDIA_URL }],
        note: "not a media reference",
      },
    }];
    expect(collectReferencedMedia(rows, SUPABASE_URL)).toEqual([MEDIA_KEY]);
  });

  it("performs a read-only dry-run and does not upload missing targets", async () => {
    vi.stubEnv("EXPECTED_SUPABASE_PROJECT_REF", TUTOR_PROJECT_REF);
    const { client, uploads } = fakeClient([{ attachments: [{ url: MEDIA_URL }] }], {
      [`${PUBLIC_MEDIA_BUCKET}/${MEDIA_KEY}`]: webpBytes(),
    });

    const result = await preparePrivateMediaMigration({ client, supabaseUrl: SUPABASE_URL });

    expect(result).toEqual({
      applied: false,
      casesScanned: 1,
      references: 1,
      alreadyPrivate: 0,
      toCopy: 1,
      copied: 0,
    });
    expect(uploads).toHaveLength(0);
  });

  it("copies missing objects with private WebP/no-cache options and is retry-safe", async () => {
    vi.stubEnv("EXPECTED_SUPABASE_PROJECT_REF", TUTOR_PROJECT_REF);
    const { client, uploads } = fakeClient([{ attachments: [{ url: MEDIA_URL }] }], {
      [`${PUBLIC_MEDIA_BUCKET}/${MEDIA_KEY}`]: webpBytes(),
    });

    const first = await preparePrivateMediaMigration({ client, supabaseUrl: SUPABASE_URL, apply: true });
    const second = await preparePrivateMediaMigration({ client, supabaseUrl: SUPABASE_URL, apply: true });

    expect(first).toMatchObject({ applied: true, references: 1, toCopy: 1, copied: 1 });
    expect(second).toMatchObject({ applied: true, references: 1, alreadyPrivate: 1, copied: 0 });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      bucket: PRIVATE_MEDIA_BUCKET,
      key: MEDIA_KEY,
      options: { contentType: "image/webp", cacheControl: "0", upsert: false },
    });
  });

  it("refuses a divergent private object instead of overwriting it", async () => {
    vi.stubEnv("EXPECTED_SUPABASE_PROJECT_REF", TUTOR_PROJECT_REF);
    const { client, uploads } = fakeClient([{ attachments: [{ url: MEDIA_URL }] }], {
      [`${PUBLIC_MEDIA_BUCKET}/${MEDIA_KEY}`]: webpBytes(0x5a),
      [`${PRIVATE_MEDIA_BUCKET}/${MEDIA_KEY}`]: webpBytes(0x2a),
    });

    await expect(preparePrivateMediaMigration({ client, supabaseUrl: SUPABASE_URL, apply: true })).rejects.toThrow(/differs/i);
    expect(uploads).toHaveLength(0);
  });

  it("does not report success when the post-upload byte verification fails", async () => {
    vi.stubEnv("EXPECTED_SUPABASE_PROJECT_REF", TUTOR_PROJECT_REF);
    const { client, uploads } = fakeClient([{ attachments: [{ url: MEDIA_URL }] }], {
      [`${PUBLIC_MEDIA_BUCKET}/${MEDIA_KEY}`]: webpBytes(),
    }, true);

    await expect(preparePrivateMediaMigration({ client, supabaseUrl: SUPABASE_URL, apply: true })).rejects.toThrow(/upload verification/i);
    expect(uploads).toHaveLength(1);
  });

  it("rejects a source that is not WebP", async () => {
    vi.stubEnv("EXPECTED_SUPABASE_PROJECT_REF", TUTOR_PROJECT_REF);
    const { client } = fakeClient([{ attachments: [{ url: MEDIA_URL }] }], {
      [`${PUBLIC_MEDIA_BUCKET}/${MEDIA_KEY}`]: Buffer.from("not-an-image"),
    });

    await expect(preparePrivateMediaMigration({ client, supabaseUrl: SUPABASE_URL })).rejects.toThrow(/valid WebP/i);
  });
});

describe("private-media metadata cutover candidate", () => {
  it("is a privileged, transactional metadata-only migration", () => {
    const sqlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "sql", "case-media-private-cutover.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    expect(sql).toMatch(/begin;/i);
    expect(sql).toMatch(/set local app\.allow_published_case_writes\s*=\s*'true'/i);
    expect(sql).toMatch(/published_write_bypass_enabled\(\)/i);
    expect(sql).toMatch(/storage\.objects/i);
    expect(sql).toMatch(/lock table public\.cases in share row exclusive mode/i);
    expect(sql).toMatch(/storage\.buckets/i);
    expect(sql).toMatch(/bucket\.public is false/i);
    expect(sql).toMatch(/teaching-case-media-private/i);
    expect(sql).toMatch(/patient_context/i);
    expect(sql).toMatch(/sourceUrl/i);
    expect(sql).toMatch(/storagePath/i);
    expect(sql).toMatch(/commit;/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/create\s+bucket/i);

    const lowerSql = sql.toLowerCase();
    const lockIndex = lowerSql.indexOf("lock table public.cases in share row exclusive mode");
    const bucketGuardIndex = lowerSql.indexOf("storage.buckets");
    const referenceCollectionIndex = lowerSql.indexOf("insert into pg_temp.private_media_cutover_refs");
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(referenceCollectionIndex);
    expect(bucketGuardIndex).toBeGreaterThan(referenceCollectionIndex);
  });
});
