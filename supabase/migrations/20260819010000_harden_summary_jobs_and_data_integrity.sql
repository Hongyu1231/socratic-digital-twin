-- Summary jobs and data-integrity hardening.
--
-- The application uses the service_role repository.  These tables and
-- functions therefore remain closed to anon/authenticated, with RLS enabled
-- as a second line of defence.  Every callable function is SECURITY INVOKER,
-- uses an explicit search_path, and is granted only to service_role.

begin;

do $$
begin
  create type public.summary_job_status as enum (
    'pending',
    'processing',
    'completed',
    'failed'
  );
exception
  when duplicate_object then null;
end;
$$;

-- Test fixtures are data, not a frontend UUID allow-list.  Existing rows whose
-- name clearly identifies them as E2E fixtures are marked during migration;
-- future fixture creation should set this column explicitly.
alter table public.cases
  add column if not exists is_test_fixture boolean not null default false;

comment on column public.cases.is_test_fixture is
  'True for disposable automated-test content. Student catalogue queries must exclude these rows.';

update public.cases
   set is_test_fixture = true,
       status = 'archived'::public.case_status,
       updated_at = greatest(updated_at, timezone('utc', now()))
 where is_test_fixture = false
   and (
     lower(title) like 'e2e %'
     or lower(slug) like 'e2e-%'
   );

alter table public.class_case_assignments
  add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.class_case_assignments'::regclass
       and conname = 'class_case_assignments_idempotency_key_not_blank'
  ) then
    alter table public.class_case_assignments
      add constraint class_case_assignments_idempotency_key_not_blank
      check (idempotency_key is null or length(btrim(idempotency_key)) > 0);
  end if;
end;
$$;

-- A key is optional, but a supplied key may identify only one assignment.  A
-- partial index preserves the ability to keep legacy rows without keys.
create unique index if not exists class_case_assignments_idempotency_key_unique_idx
  on public.class_case_assignments (idempotency_key)
  where idempotency_key is not null;

-- PostgREST's `on_conflict=idempotency_key` cannot infer a partial index
-- because it cannot include an index predicate in the conflict target.  Keep a
-- nullable, non-partial unique index for that API path: PostgreSQL permits
-- multiple NULLs, so it has the same optional-key semantics while retaining
-- the explicit partial index above for filtered lookups.
create unique index if not exists class_case_assignments_idempotency_key_upsert_idx
  on public.class_case_assignments (idempotency_key);

comment on column public.class_case_assignments.idempotency_key is
  'Optional stable client/E2E key used to make assignment creation idempotent.';

alter table public.sessions
  add column if not exists summary_generation_status text not null default 'not_requested',
  add column if not exists summary_generation_error text,
  add column if not exists summary_generated_at timestamptz;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.sessions'::regclass
       and conname = 'sessions_summary_generation_status_valid'
  ) then
    alter table public.sessions
      add constraint sessions_summary_generation_status_valid
      check (summary_generation_status in ('not_requested', 'pending', 'ready', 'failed'));
  end if;
end;
$$;

comment on column public.sessions.summary_generation_status is
  'Deterministic summary is available immediately; this tracks optional asynchronous LLM enhancement.';

create table if not exists public.session_summary_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  status public.summary_job_status not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  locked_by text,
  claim_token uuid,
  last_error text,
  provider text,
  model text,
  summary jsonb,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint session_summary_jobs_attempts_valid check (attempt_count between 0 and 3),
  constraint session_summary_jobs_summary_object check (
    summary is null or jsonb_typeof(summary) = 'object'
  ),
  constraint session_summary_jobs_worker_not_blank check (
    locked_by is null or length(btrim(locked_by)) > 0
  ),
  constraint session_summary_jobs_timestamps_order check (updated_at >= created_at)
);

create index if not exists session_summary_jobs_pending_idx
  on public.session_summary_jobs (available_at, created_at)
  where status = 'pending';
create index if not exists session_summary_jobs_processing_idx
  on public.session_summary_jobs (locked_at)
  where status = 'processing';

alter table public.session_summary_jobs enable row level security;
alter table public.session_summary_jobs force row level security;
revoke all on table public.session_summary_jobs from public, anon, authenticated;
grant select, insert, update on table public.session_summary_jobs to service_role;
grant usage on schema public to service_role;

-- Queue a summary whenever a session first becomes completed.  The trigger is
-- deliberately limited to status transitions: a later context/session update
-- cannot create duplicate jobs for the same completion.
create or replace function public.prepare_session_summary_generation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'completed'::public.session_status
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.summary_generation_status := 'pending';
    new.summary_generation_error := null;
    new.summary_generated_at := null;
    new.context := jsonb_set(
      jsonb_set(
        coalesce(new.context, '{}'::jsonb),
        '{summaryGenerationStatus}',
        '"pending"'::jsonb,
        true
      ),
      '{summaryGenerationError}',
      'null'::jsonb,
      true
    );
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_session_summary_job()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.status <> 'completed'::public.session_status
     or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  insert into public.session_summary_jobs (
    session_id,
    status,
    attempt_count,
    available_at,
    locked_at,
    locked_by,
    claim_token,
    last_error,
    provider,
    model,
    summary,
    completed_at,
    failed_at,
    updated_at
  )
  values (
    new.id,
    'pending'::public.summary_job_status,
    0,
    timezone('utc', now()),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    timezone('utc', now())
  )
  on conflict (session_id) do update
    set status = 'pending'::public.summary_job_status,
        attempt_count = 0,
        available_at = timezone('utc', now()),
        locked_at = null,
        locked_by = null,
        claim_token = null,
        last_error = null,
        provider = null,
        model = null,
        summary = null,
        completed_at = null,
        failed_at = null,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

-- Archive transitions close assignments in the same transaction.  Keeping
-- this as a trigger also covers admin/repository paths that update cases
-- directly instead of calling archive_case().
create or replace function public.close_assignments_for_archived_case()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'archived'::public.case_status
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    update public.class_case_assignments
       set status = 'closed',
           updated_at = timezone('utc', now())
     where case_id = new.id
       and status = 'open';
  end if;
  return new;
end;
$$;

create or replace function public.archive_case(p_case_id uuid)
returns public.cases
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_case public.cases%rowtype;
begin
  if p_case_id is null then
    raise exception using errcode = '22023', message = 'Case id is required';
  end if;

  update public.cases
     set status = 'archived'::public.case_status,
         updated_at = timezone('utc', now())
   where id = p_case_id
  returning * into v_case;

  if not found then
    raise exception using errcode = 'P0002', message = 'Case does not exist';
  end if;

  return v_case;
end;
$$;

-- A database guard prevents a race where a caller checks case status and then
-- inserts a session after another transaction archives the case.  Existing
-- historical sessions are untouched because this is INSERT-only.
create or replace function public.reject_archived_case_session()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_case_status public.case_status;
begin
  -- Serialize this check with archive_case() and direct case status updates.
  -- A shared lock lets concurrent session starts proceed together, while it
  -- conflicts with the NO KEY UPDATE lock taken by an archive UPDATE.
  -- Whichever transaction locks the case row first is ordered first: a session
  -- that gets the lock first is created before the archive, while a session
  -- that waits for an already-committed archive sees the archived status.
  select c.status
    into v_case_status
    from public.cases as c
   where c.id = new.case_id
   for share;

  if v_case_status = 'archived'::public.case_status then
    raise exception using
      errcode = '55000',
      message = 'Cannot start a session for an archived case';
  end if;
  return new;
end;
$$;

-- Claim rows atomically and keep the external LLM call outside the database
-- transaction.  A claim token prevents a stale worker from applying/failing a
-- row after its lease has been reclaimed by another worker.
create or replace function public.claim_session_summary_jobs(
  p_worker_id text,
  p_limit integer default 5
)
returns setof public.session_summary_jobs
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_stale record;
begin
  if nullif(btrim(p_worker_id), '') is null or length(btrim(p_worker_id)) > 128 then
    raise exception using errcode = '22023', message = 'A bounded worker id is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = '22023', message = 'Worker batch size must be between 1 and 20';
  end if;

  -- A worker that died after its third claim must not leave a permanently
  -- processing row.  Mark it failed before selecting new work.
  for v_stale in
    select j.id, j.session_id
      from public.session_summary_jobs as j
     where j.status = 'processing'::public.summary_job_status
       and j.locked_at is not null
       and j.locked_at < v_now - interval '10 minutes'
       and j.attempt_count >= 3
     for update skip locked
  loop
    update public.session_summary_jobs
       set status = 'failed'::public.summary_job_status,
           failed_at = v_now,
           locked_at = null,
           locked_by = null,
           claim_token = null,
           last_error = coalesce(last_error, 'Worker lease expired after the maximum attempts'),
           updated_at = v_now
     where id = v_stale.id;

    update public.sessions
       set summary_generation_status = 'failed',
           summary_generation_error = coalesce(
             summary_generation_error,
             'Worker lease expired after the maximum attempts'
           ),
           updated_at = v_now,
           context = jsonb_set(
             jsonb_set(coalesce(context, '{}'::jsonb), '{summaryGenerationStatus}', '"failed"'::jsonb, true),
             '{summaryGenerationError}',
             to_jsonb(coalesce(summary_generation_error, 'Worker lease expired after the maximum attempts')),
             true
           )
     where id = v_stale.session_id;
  end loop;

  return query
  with picked as (
    select j.id
      from public.session_summary_jobs as j
     where j.attempt_count < 3
       and (
         (
           j.status = 'pending'::public.summary_job_status
           and j.available_at <= v_now
         )
         or (
           j.status = 'processing'::public.summary_job_status
           and j.locked_at is not null
           and j.locked_at < v_now - interval '10 minutes'
         )
       )
     order by j.available_at, j.created_at, j.id
     limit p_limit
     for update skip locked
  )
  update public.session_summary_jobs as j
     set status = 'processing'::public.summary_job_status,
         attempt_count = j.attempt_count + 1,
         locked_at = v_now,
         locked_by = btrim(p_worker_id),
         claim_token = gen_random_uuid(),
         updated_at = v_now
    from picked
   where j.id = picked.id
  returning j.*;
end;
$$;

create or replace function public.apply_session_summary_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_summary jsonb,
  p_provider text,
  p_model text default null
)
returns public.session_summary_jobs
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_job public.session_summary_jobs%rowtype;
  v_session public.sessions%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if p_job_id is null or p_claim_token is null then
    raise exception using errcode = '22023', message = 'Job id and claim token are required';
  end if;
  if nullif(btrim(p_provider), '') is null or length(btrim(p_provider)) > 64 then
    raise exception using errcode = '22023', message = 'A bounded summary provider is required';
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception using errcode = '22023', message = 'Summary must be a JSON object';
  end if;
  if jsonb_typeof(p_summary -> 'strengths') <> 'array'
     or coalesce(jsonb_array_length(p_summary -> 'strengths'), 0) < 1 then
    raise exception using errcode = '22023', message = 'Summary must contain at least one strength';
  end if;
  if jsonb_typeof(p_summary -> 'nextSteps') <> 'array'
     or coalesce(jsonb_array_length(p_summary -> 'nextSteps'), 0) < 1 then
    raise exception using errcode = '22023', message = 'Summary must contain at least one next step';
  end if;
  if not (
    p_summary ? 'overallScore'
    and p_summary ? 'headline'
    and p_summary ? 'narrative'
    and p_summary ? 'weaknesses'
    and p_summary ? 'completedAllPhases'
  ) then
    raise exception using errcode = '22023', message = 'Summary is missing required fields';
  end if;

  select *
    into v_job
    from public.session_summary_jobs
   where id = p_job_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Summary job does not exist';
  end if;

  -- A retried HTTP request after a successful commit is an idempotent no-op.
  if v_job.status = 'completed'::public.summary_job_status then
    return v_job;
  end if;
  if v_job.status <> 'processing'::public.summary_job_status
     or v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = '55000', message = 'Summary job claim is no longer valid';
  end if;

  select *
    into v_session
    from public.sessions
   where id = v_job.session_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Summary session does not exist';
  end if;
  if v_session.status <> 'completed'::public.session_status then
    raise exception using errcode = '55000', message = 'Only completed sessions can receive a summary';
  end if;

  update public.sessions
     set context = jsonb_set(
       jsonb_set(
         jsonb_set(
           jsonb_set(coalesce(context, '{}'::jsonb), '{summary}', p_summary, true),
           '{summaryGenerationStatus}',
           '"ready"'::jsonb,
           true
         ),
         '{summaryGenerationError}',
         'null'::jsonb,
         true
       ),
       '{summaryGeneratedAt}',
       to_jsonb(v_now),
       true
     ),
         summary_generation_status = 'ready',
         summary_generation_error = null,
         summary_generated_at = v_now,
         updated_at = v_now
   where id = v_session.id;

  update public.session_summary_jobs
     set status = 'completed'::public.summary_job_status,
         summary = p_summary,
         provider = btrim(p_provider),
         model = nullif(btrim(coalesce(p_model, '')), ''),
         completed_at = v_now,
         failed_at = null,
         locked_at = null,
         locked_by = null,
         claim_token = null,
         last_error = null,
         updated_at = v_now
   where id = v_job.id;

  select job.*
    into v_job
    from public.session_summary_jobs as job
   where job.id = v_job.id;
  return v_job;
end;
$$;

create or replace function public.fail_session_summary_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error text default null
)
returns public.session_summary_jobs
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_job public.session_summary_jobs%rowtype;
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'Summary provider failed'), 2000);
  v_next_status public.summary_job_status;
  v_next_at timestamptz;
  v_now timestamptz := timezone('utc', now());
begin
  if p_job_id is null or p_claim_token is null then
    raise exception using errcode = '22023', message = 'Job id and claim token are required';
  end if;

  select *
    into v_job
    from public.session_summary_jobs
   where id = p_job_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Summary job does not exist';
  end if;

  -- A worker may retry its request after the database already accepted the
  -- failure.  Do not let that request mutate a newer claim.
  if v_job.status <> 'processing'::public.summary_job_status then
    return v_job;
  end if;
  if v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = '55000', message = 'Summary job claim is no longer valid';
  end if;

  v_next_status := case
    when v_job.attempt_count >= 3 then 'failed'::public.summary_job_status
    else 'pending'::public.summary_job_status
  end;
  v_next_at := case
    when v_next_status = 'pending'::public.summary_job_status then
      v_now + make_interval(secs => (30 * power(2, greatest(v_job.attempt_count - 1, 0)))::integer)
    else v_now
  end;

  update public.session_summary_jobs
     set status = v_next_status,
         available_at = v_next_at,
         failed_at = case when v_next_status = 'failed'::public.summary_job_status then v_now else null end,
         locked_at = null,
         locked_by = null,
         claim_token = null,
         last_error = v_error,
         updated_at = v_now
   where id = v_job.id;

  update public.sessions
     set summary_generation_status = case
       when v_next_status = 'failed'::public.summary_job_status then 'failed'
       else 'pending'
     end,
         summary_generation_error = v_error,
         updated_at = v_now,
         context = jsonb_set(
           jsonb_set(
             coalesce(context, '{}'::jsonb),
             '{summaryGenerationStatus}',
             case when v_next_status = 'failed'::public.summary_job_status then '"failed"'::jsonb else '"pending"'::jsonb end,
             true
           ),
           '{summaryGenerationError}',
           to_jsonb(v_error),
           true
         )
   where id = v_job.session_id;

  select job.*
    into v_job
    from public.session_summary_jobs as job
   where job.id = v_job.id;
  return v_job;
end;
$$;

drop trigger if exists sessions_prepare_summary_generation on public.sessions;
create trigger sessions_prepare_summary_generation
before insert or update of status on public.sessions
for each row execute function public.prepare_session_summary_generation();

drop trigger if exists sessions_enqueue_summary_job on public.sessions;
create trigger sessions_enqueue_summary_job
after insert or update of status on public.sessions
for each row execute function public.enqueue_session_summary_job();

drop trigger if exists cases_close_assignments_when_archived on public.cases;
create trigger cases_close_assignments_when_archived
after insert or update of status on public.cases
for each row execute function public.close_assignments_for_archived_case();

drop trigger if exists sessions_reject_archived_case on public.sessions;
create trigger sessions_reject_archived_case
before insert on public.sessions
for each row execute function public.reject_archived_case_session();

-- Backfill old completed sessions once.  Existing deterministic summaries stay
-- in sessions.context while the worker may later replace them with an AI
-- enhancement.  The unique session_id key makes this safe to repeat.
update public.sessions
   set summary_generation_status = 'pending',
       summary_generation_error = null,
       summary_generated_at = null,
       context = jsonb_set(
         jsonb_set(coalesce(context, '{}'::jsonb), '{summaryGenerationStatus}', '"pending"'::jsonb, true),
         '{summaryGenerationError}',
         'null'::jsonb,
         true
       ),
       updated_at = timezone('utc', now())
 where status = 'completed'::public.session_status
   and summary_generation_status = 'not_requested';

insert into public.session_summary_jobs (session_id)
select s.id
  from public.sessions as s
 where s.status = 'completed'::public.session_status
on conflict (session_id) do nothing;

-- Close legacy duplicate open assignments without deleting their historical
-- sessions. Keep the most recently created row for each class/case pair. This
-- is a one-time cleanup, not a global uniqueness rule, so a professor may
-- intentionally assign the same case again in a future teaching period.
with ranked_open_assignments as (
  select id,
         row_number() over (
           partition by class_id, case_id
           order by created_at desc, id desc
         ) as duplicate_rank
    from public.class_case_assignments
   where status = 'open'
)
update public.class_case_assignments as assignment
   set status = 'closed',
       updated_at = timezone('utc', now())
  from ranked_open_assignments as ranked
 where assignment.id = ranked.id
   and ranked.duplicate_rank > 1;

-- Archive is a state transition even when called outside archive_case(); make
-- existing archived data obey the same assignment invariant.
update public.class_case_assignments
   set status = 'closed',
       updated_at = timezone('utc', now())
 where status = 'open'
   and exists (
     select 1
       from public.cases as c
      where c.id = class_case_assignments.case_id
        and c.status = 'archived'::public.case_status
   );

revoke all on function public.prepare_session_summary_generation() from public, anon, authenticated;
revoke all on function public.enqueue_session_summary_job() from public, anon, authenticated;
revoke all on function public.close_assignments_for_archived_case() from public, anon, authenticated;
revoke all on function public.archive_case(uuid) from public, anon, authenticated;
revoke all on function public.reject_archived_case_session() from public, anon, authenticated;
revoke all on function public.claim_session_summary_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.apply_session_summary_job(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.fail_session_summary_job(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.prepare_session_summary_generation() to service_role;
grant execute on function public.enqueue_session_summary_job() to service_role;
grant execute on function public.close_assignments_for_archived_case() to service_role;
grant execute on function public.archive_case(uuid) to service_role;
grant execute on function public.reject_archived_case_session() to service_role;
grant execute on function public.claim_session_summary_jobs(text, integer) to service_role;
grant execute on function public.apply_session_summary_job(uuid, uuid, jsonb, text, text) to service_role;
grant execute on function public.fail_session_summary_job(uuid, uuid, text) to service_role;

commit;
