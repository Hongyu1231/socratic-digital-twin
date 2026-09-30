#!/usr/bin/env node
/* global console */

/**
 * Isolated SQL regression for the staged private-media metadata cutover.
 *
 * This intentionally does not use Supabase credentials or the Data API. Every
 * query is sent to the fixed local CI Postgres container through docker exec;
 * each scenario rolls its synthetic rows back before the next scenario.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOCAL_CONTAINER = "supabase_db_socratic-digital-twin-poc";
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATH = path.join(SCRIPT_DIRECTORY, "sql", "case-media-private-cutover.sql");
const PUBLIC_BUCKET = "teaching-case-media";
const PRIVATE_BUCKET = "teaching-case-media-private";
const TUTOR_PROJECT_REF = "zulvdacbqvmqmtotyeuc";
const TUTOR_ORIGIN = `https://${TUTOR_PROJECT_REF}.supabase.co`;

function fail(message) {
  throw new Error(message);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readCandidateBody() {
  const source = fs.readFileSync(CANDIDATE_PATH, "utf8");
  const begin = source.match(/^\s*begin\s*;/im);
  if (!begin || begin.index === undefined) fail("Cutover candidate is missing its outer BEGIN; refusing to run SQL regression.");
  const withoutBegin = source.slice(begin.index + begin[0].length);
  const commit = withoutBegin.match(/\bcommit\s*;\s*$/i);
  if (!commit || commit.index === undefined) fail("Cutover candidate is missing its outer COMMIT; refusing to run SQL regression.");
  return withoutBegin.slice(0, commit.index).trim();
}

function dockerPsql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", LOCAL_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-At"],
    { input: sql, encoding: "utf8", timeout: 60_000 },
  );
  if (result.error) {
    throw new Error(`Could not run local Docker psql: ${result.error.message}`);
  }
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function diagnostic(result) {
  const source = (result.stderr || result.stdout).trim();
  const lastLine = source.split(/\r?\n/).filter(Boolean).at(-1);
  return lastLine ? lastLine.slice(0, 400) : "no PostgreSQL diagnostic";
}

function requireSuccess(result, label) {
  if (result.status !== 0) fail(`${label} failed: ${diagnostic(result)}`);
}

function assertStorageSchema() {
  const result = dockerPsql("select coalesce(to_regclass('storage.objects')::text, '<missing>') || '|' || coalesce(to_regclass('storage.buckets')::text, '<missing>');\n");
  requireSuccess(result, "Local Supabase storage-schema preflight");
  const schema = result.stdout.trim();
  if (schema !== "storage.objects|storage.buckets") {
    fail("Local Supabase storage tables are unavailable; report this to the database owner instead of initializing storage manually.");
  }
}

function newFixture(mode) {
  const caseId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  const storagePath = `${"a".repeat(64)}/${attachmentId}.webp`;
  return {
    mode,
    caseId,
    adminId,
    attachmentId,
    storagePath,
    publicUrl: `${TUTOR_ORIGIN}/storage/v1/object/public/${PUBLIC_BUCKET}/${storagePath}`,
    citationUrl: "https://example.org/citation",
    privateIsPublic: mode === "public-bucket",
    includePrivateObject: mode !== "missing-object" && mode !== "no-refs",
    hasReferences: mode !== "no-refs",
  };
}

function fixtureSetupSql(fixture) {
  const attachment = fixture.hasReferences
    ? `jsonb_build_array(jsonb_build_object(
          'id', ${sqlString(fixture.attachmentId)},
          'kind', 'image',
          'title', 'Synthetic OPG',
          'description', 'Synthetic regression media',
          'url', ${sqlString(fixture.publicUrl)},
          'sourceUrl', ${sqlString(fixture.citationUrl)},
          'sourceLabel', 'Synthetic citation'
        ))`
    : "'[]'::jsonb";
  const context = fixture.hasReferences
    ? `jsonb_build_object(
          'sentinel', 'preserve-context',
          'attachments', ${attachment}
        )`
    : "jsonb_build_object('sentinel', 'no-reference-context')";
  const privateBucketSetup = fixture.mode === "no-refs"
    ? `
delete from storage.objects where bucket_id = ${sqlString(PRIVATE_BUCKET)};
delete from storage.buckets where id = ${sqlString(PRIVATE_BUCKET)};
`
    : `
insert into storage.buckets (id, name, public)
values (${sqlString(PRIVATE_BUCKET)}, ${sqlString(PRIVATE_BUCKET)}, ${fixture.privateIsPublic ? "true" : "false"})
on conflict (id) do update set public = excluded.public;
`;
  const privateObjectSetup = fixture.includePrivateObject
    ? `
insert into storage.objects (id, bucket_id, name, metadata)
values (gen_random_uuid(), ${sqlString(PRIVATE_BUCKET)}, ${sqlString(fixture.storagePath)}, '{"mimetype":"image/webp"}'::jsonb);
`
    : "";

  return `
begin;
set local app.allow_published_case_writes = 'true';

do $$
begin
  if not public.published_write_bypass_enabled() then
    raise exception 'Test database cannot use the publication bypass';
  end if;
end;
$$;

create temp table private_media_test_ids (
  case_id uuid primary key,
  admin_id uuid not null,
  attachment_id uuid not null,
  storage_path text not null
) on commit drop;

insert into private_media_test_ids (case_id, admin_id, attachment_id, storage_path)
values (${sqlString(fixture.caseId)}::uuid, ${sqlString(fixture.adminId)}::uuid, ${sqlString(fixture.attachmentId)}::uuid, ${sqlString(fixture.storagePath)});

insert into public.users (id, email, display_name, role)
values (${sqlString(fixture.adminId)}::uuid, ${sqlString(`private-media-${fixture.adminId}@test.invalid`)}, 'Private Media SQL Test', 'admin'::public.user_role);

with seeded as (
  select jsonb_populate_record(
    null::public.cases,
    jsonb_build_object(
      'id', ${sqlString(fixture.caseId)}::uuid,
      'slug', ${sqlString(`private-media-${fixture.caseId}`)},
      'title', 'Synthetic private media cutover case',
      'specialty', 'dentistry',
      'diagnosis', 'Synthetic diagnosis',
      'presenting_complaint', 'Synthetic complaint',
      'status', 'active',
      'patient_context', ${context},
      'tags', jsonb_build_array('synthetic', 'media-cutover'),
      'created_by', ${sqlString(fixture.adminId)}::uuid,
      'source_case_id', null,
      'version', 1,
      'published_at', timezone('utc', now()),
      'difficulty', 'intermediate',
      'is_test_fixture', true,
      'attachments', ${attachment}
    )
  ) as case_row
)
insert into public.cases (
  id, slug, title, specialty, diagnosis, presenting_complaint, status,
  patient_context, tags, created_by, source_case_id, version, published_at,
  difficulty, is_test_fixture, attachments
)
select
  (case_row).id, (case_row).slug, (case_row).title, (case_row).specialty,
  (case_row).diagnosis, (case_row).presenting_complaint, (case_row).status,
  (case_row).patient_context, (case_row).tags, (case_row).created_by,
  (case_row).source_case_id, (case_row).version, (case_row).published_at,
  (case_row).difficulty, (case_row).is_test_fixture, (case_row).attachments
from seeded;

insert into storage.buckets (id, name, public)
values (${sqlString(PUBLIC_BUCKET)}, ${sqlString(PUBLIC_BUCKET)}, true)
on conflict (id) do update set public = excluded.public;
${privateBucketSetup}
${fixture.hasReferences ? `
insert into storage.objects (id, bucket_id, name, metadata)
values (gen_random_uuid(), ${sqlString(PUBLIC_BUCKET)}, ${sqlString(fixture.storagePath)}, '{"mimetype":"image/webp"}'::jsonb);
` : ""}
${privateObjectSetup}
`;
}

function successAssertionsSql(fixture) {
  if (!fixture.hasReferences) {
    return `
do $$
begin
  if not exists (select 1 from public.cases where id = ${sqlString(fixture.caseId)}::uuid and attachments = '[]'::jsonb)
     or not exists (select 1 from public.cases where id = ${sqlString(fixture.caseId)}::uuid and patient_context ->> 'sentinel' = 'no-reference-context') then
    raise exception 'No-reference case changed unexpectedly';
  end if;
end;
$$;
`;
  }
  return `
do $$
declare
  current_case public.cases;
  top_attachment jsonb;
  mirror_attachment jsonb;
begin
  select c.* into current_case from public.cases as c where c.id = ${sqlString(fixture.caseId)}::uuid;
  if current_case.id is null then raise exception 'Synthetic case disappeared'; end if;
  top_attachment := current_case.attachments -> 0;
  mirror_attachment := current_case.patient_context -> 'attachments' -> 0;
  if top_attachment ->> 'storagePath' is distinct from ${sqlString(fixture.storagePath)} then raise exception 'Top-level storagePath mismatch'; end if;
  if top_attachment ? 'url' then raise exception 'Top-level public URL remains'; end if;
  if top_attachment ->> 'sourceUrl' is distinct from ${sqlString(fixture.citationUrl)} then raise exception 'External citation was not preserved'; end if;
  if top_attachment ->> 'id' is distinct from ${sqlString(fixture.attachmentId)} then raise exception 'Attachment ID changed'; end if;
  if mirror_attachment ->> 'storagePath' is distinct from ${sqlString(fixture.storagePath)} then raise exception 'Legacy mirror storagePath mismatch'; end if;
  if mirror_attachment ? 'url' then raise exception 'Legacy mirror public URL remains'; end if;
  if mirror_attachment ->> 'sourceUrl' is distinct from ${sqlString(fixture.citationUrl)} then raise exception 'Legacy mirror citation was not preserved'; end if;
  if mirror_attachment ->> 'id' is distinct from ${sqlString(fixture.attachmentId)} then raise exception 'Legacy mirror ID changed'; end if;
  if current_case.title <> 'Synthetic private media cutover case'
     or current_case.diagnosis <> 'Synthetic diagnosis'
     or current_case.presenting_complaint <> 'Synthetic complaint'
     or current_case.version <> 1
     or current_case.patient_context ->> 'sentinel' <> 'preserve-context' then
    raise exception 'Unrelated case content changed';
  end if;
end;
$$;
`;
}

function successfulScenarioSql(fixture, candidateBody) {
  const snapshot = `
create temp table private_media_cutover_snapshot on commit drop as
select to_jsonb(c) as row_json from public.cases as c where c.id = ${sqlString(fixture.caseId)}::uuid;
drop table if exists pg_temp.private_media_cutover_refs;
${candidateBody}
do $$
declare
  current_json jsonb;
  snapshot_json jsonb;
begin
  select to_jsonb(c) into current_json from public.cases as c where c.id = ${sqlString(fixture.caseId)}::uuid;
  select row_json into snapshot_json from private_media_cutover_snapshot;
  if current_json is distinct from snapshot_json then raise exception 'Second cutover changed an already-cut-over case'; end if;
end;
$$;
`;
  return `${fixtureSetupSql(fixture)}${candidateBody}\n${successAssertionsSql(fixture)}${snapshot}\nrollback;\n`;
}

function failingScenarioSql(fixture, candidateBody) {
  return `${fixtureSetupSql(fixture)}${candidateBody}\n`;
}

function assertRolledBack(fixture) {
  const result = dockerPsql(`select count(*) from public.cases where id = ${sqlString(fixture.caseId)}::uuid;\n`);
  requireSuccess(result, `Rollback check for ${fixture.mode}`);
  if (result.stdout.trim() !== "0") fail(`Scenario ${fixture.mode} left its synthetic case behind after failure.`);
}

function runSuccessScenario(fixture, candidateBody) {
  const result = dockerPsql(successfulScenarioSql(fixture, candidateBody));
  requireSuccess(result, `Successful ${fixture.mode} cutover`);
}

function runFailureScenario(fixture, candidateBody) {
  const result = dockerPsql(failingScenarioSql(fixture, candidateBody));
  if (result.status === 0) fail(`Scenario ${fixture.mode} unexpectedly succeeded.`);
  const expected = fixture.mode === "public-bucket"
    ? "Private teaching-media bucket is public; refusing metadata cutover"
    : "Private teaching-media objects are incomplete; run the copy preparation first";
  if (!result.stderr.includes(expected)) fail(`Scenario ${fixture.mode} failed for the wrong reason: ${diagnostic(result)}`);
  assertRolledBack(fixture);
}

export function run() {
  if (process.env.SUPABASE_DATA_ENVIRONMENT !== "test") {
    fail("Refusing local SQL regression unless SUPABASE_DATA_ENVIRONMENT=test.");
  }
  const candidateBody = readCandidateBody();
  assertStorageSchema();

  runSuccessScenario(newFixture("success"), candidateBody);
  runSuccessScenario(newFixture("no-refs"), candidateBody);
  runFailureScenario(newFixture("public-bucket"), candidateBody);
  runFailureScenario(newFixture("missing-object"), candidateBody);

  console.log("Private-media SQL cutover regression passed: success, no-reference no-op, public-bucket rejection, missing-object rejection.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Private-media SQL regression failed.");
    process.exitCode = 1;
  }
}
