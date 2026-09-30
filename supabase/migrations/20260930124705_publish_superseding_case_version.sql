-- Superseding publication for linked case versions.
--
-- This migration follows 20260930124702_add_superseded_case_status.sql.  The
-- enum value must be committed before it can appear in a check constraint or
-- PL/pgSQL comparison.

begin;

alter table public.cases
  drop constraint if exists cases_publication_consistent;

alter table public.cases
  add constraint cases_publication_consistent check (
    (status = 'draft'::public.case_status and published_at is null)
    or
    (status = 'active'::public.case_status and published_at is not null)
    or
    -- Archived cases may be archived before publication, preserving the
    -- existing draft -> archived contract.
    status = 'archived'::public.case_status
    or
    (status = 'superseded'::public.case_status and published_at is not null)
  );

-- Keep the existing immutability contract, adding only the explicit
-- active -> superseded transition.  The content comparison prevents callers
-- from using that transition to edit a published version in place.
create or replace function public.guard_case_publication_contract()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.published_write_bypass_enabled() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'draft'::public.case_status
       and new.published_at is null then
      return new;
    end if;
    raise exception using
      errcode = '55000',
      message = 'Cases must be created as draft before publication';
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft'::public.case_status then
      raise exception using
        errcode = '55000',
        message = 'Published or archived cases are immutable and cannot be deleted';
    end if;
    return old;
  end if;

  perform 1 from public.cases where id = old.id for update;

  if old.status = 'draft'::public.case_status
     and new.status = 'draft'::public.case_status then
    return new;
  end if;

  if old.status = 'draft'::public.case_status
     and new.status in ('active'::public.case_status, 'archived'::public.case_status)
     and (to_jsonb(old) - array['status', 'published_at', 'updated_at']::text[])
         = (to_jsonb(new) - array['status', 'published_at', 'updated_at']::text[]) then
    if new.status = 'active'::public.case_status and new.published_at is null then
      raise exception using
        errcode = '23514',
        message = 'An active case must have published_at';
    end if;
    if new.status = 'active'::public.case_status
       and not exists (
         select 1
           from public.case_phases
          where case_id = old.id
       ) then
      raise exception using
        errcode = '23514',
        message = 'Case cannot be published without phases';
    end if;
    if new.status = 'archived'::public.case_status and new.published_at is not null then
      raise exception using
        errcode = '23514',
        message = 'A draft archived without publication must keep published_at null';
    end if;
    return new;
  end if;

  if old.status = 'active'::public.case_status
     and new.status in (
       'archived'::public.case_status,
       'superseded'::public.case_status
     )
     and new.published_at is not distinct from old.published_at
     and (to_jsonb(old) - array['status', 'published_at', 'updated_at']::text[])
         = (to_jsonb(new) - array['status', 'published_at', 'updated_at']::text[]) then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'Published case content is immutable; create a new draft version';
end;
$$;

-- A superseded version may remain assigned when the publisher deliberately
-- chooses not to move open assignments.  In that case an assignment-scoped
-- session start is still valid; a direct unassigned start is not.
create or replace function public.reject_archived_case_session()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_case_status public.case_status;
  v_assignment_case_id uuid;
  v_assignment_status text;
begin
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

  if v_case_status = 'superseded'::public.case_status then
    select a.case_id, a.status
      into v_assignment_case_id, v_assignment_status
      from public.class_case_assignments as a
     where a.id = new.class_case_assignment_id
       for share;
    if v_assignment_case_id is distinct from new.case_id
       or v_assignment_status <> 'open' then
      raise exception using
        errcode = '55000',
        message = 'Cannot start a session for a superseded case without an open assignment';
    end if;
  end if;

  return new;
end;
$$;

-- New assignment rows may only point at a currently active case.  Locking the
-- target case while checking its status closes the publish/assignment race:
-- either the insert gets the share lock first and publication moves the row,
-- or publication wins and the later insert observes the superseded status.
-- Updating status, due dates, or other assignment metadata does not invoke
-- this trigger, so historical assignment rows remain editable for cleanup.
create or replace function public.guard_case_assignment_case()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_case_status public.case_status;
begin
  if tg_op = 'UPDATE'
     and new.case_id is not distinct from old.case_id then
    -- UPDATE OF case_id fires even when an upsert writes the same value.
    -- Preserve metadata/status edits on historical assignments.
    return new;
  end if;

  select c.status
    into v_case_status
    from public.cases as c
   where c.id = new.case_id
   for share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Assignment case does not exist';
  end if;

  if v_case_status <> 'active'::public.case_status then
    raise exception using
      errcode = '55000',
      message = 'Assignments may target only active cases';
  end if;

  return new;
end;
$$;

drop trigger if exists class_case_assignments_guard_case on public.class_case_assignments;
create trigger class_case_assignments_guard_case
before insert or update of case_id on public.class_case_assignments
for each row execute function public.guard_case_assignment_case();

-- Reject an already-published parent before taking two parent locks.  This
-- avoids the only invalid phase-move cycle: a move from a draft sibling into
-- a published lineage root can otherwise lock the sibling before waiting on a
-- root already held by publish_case.  The ordered locked recheck remains for
-- the concurrent draft -> publish race.
create or replace function public.guard_case_phase_publication_contract()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  old_status public.case_status;
  new_status public.case_status;
begin
  if public.published_write_bypass_enabled() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    select c.status
      into new_status
      from public.cases as c
     where c.id = new.case_id
     for update;
    if not found then
      raise exception using errcode = '23503', message = 'Case parent does not exist';
    end if;
    if new_status <> 'draft'::public.case_status then
      raise exception using
        errcode = '55000',
        message = 'Published case phases are immutable';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select c.status
      into old_status
      from public.cases as c
     where c.id = old.case_id
     for update;
    -- A draft case delete cascades to its phases.  The parent may be invisible
    -- by the time PostgreSQL invokes the cascade trigger, so allow that path;
    -- published case deletion is rejected by the case trigger first.
    if found and old_status <> 'draft'::public.case_status then
      raise exception using
        errcode = '55000',
        message = 'Published case phases are immutable';
    end if;
    return old;
  end if;

  -- Fast-fail an invalid move based on committed status, before taking either
  -- parent lock.  If both are still drafts, lock both parents in ID order and
  -- recheck below so a concurrent publication cannot slip through.
  if old.case_id is distinct from new.case_id then
    select c.status into old_status from public.cases as c where c.id = old.case_id;
    select c.status into new_status from public.cases as c where c.id = new.case_id;
    if old_status is null or new_status is null then
      raise exception using errcode = '23503', message = 'Case parent does not exist';
    end if;
    if old_status <> 'draft'::public.case_status
       or new_status <> 'draft'::public.case_status then
      raise exception using
        errcode = '55000',
        message = 'Published case phases are immutable';
    end if;
  end if;

  perform 1
    from public.cases as c
   where c.id in (old.case_id, new.case_id)
   order by c.id
   for update;

  select c.status into old_status from public.cases as c where c.id = old.case_id;
  select c.status into new_status from public.cases as c where c.id = new.case_id;
  if old_status is null or new_status is null then
    raise exception using errcode = '23503', message = 'Case parent does not exist';
  end if;
  if old_status <> 'draft'::public.case_status
     or new_status <> 'draft'::public.case_status then
    raise exception using
      errcode = '55000',
      message = 'Published case phases are immutable';
  end if;
  return new;
end;
$$;

-- Publish a draft version and, when requested, move the existing open
-- assignment rows to it.  Moving updates the rows in place so historical
-- sessions retain their original sessions.case_id and therefore continue to
-- read the content/version on which they started.
create or replace function public.publish_case(
  p_case_id uuid,
  p_published_at timestamptz,
  p_move_open_assignments boolean
)
returns public.cases
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_target public.cases%rowtype;
  v_lineage_id uuid;
  v_lineage_root public.cases%rowtype;
  v_sibling public.cases%rowtype;
  v_active_id uuid;
  v_active_count integer := 0;
  v_max_version integer := 0;
  v_published_at timestamptz := coalesce(p_published_at, timezone('utc', now()));
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Only service_role may publish case versions';
  end if;
  if p_case_id is null then
    raise exception using errcode = '22023', message = 'Case id is required';
  end if;

  -- Lookup the target and lineage before taking locks.  The root lock below
  -- is the deterministic serialization point for every publish in a lineage.
  select *
    into v_target
    from public.cases
   where id = p_case_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Case does not exist';
  end if;
  if v_target.status <> 'draft'::public.case_status then
    raise exception using
      errcode = 'P0001',
      message = format('Case cannot be published from status %s', v_target.status);
  end if;

  v_lineage_id := coalesce(v_target.source_case_id, v_target.id);
  select *
    into v_lineage_root
    from public.cases
   where id = v_lineage_id
   for update;
  if not found then
    raise exception using errcode = '23503', message = 'Case lineage root does not exist';
  end if;
  if v_lineage_root.source_case_id is not null then
    raise exception using
      errcode = '22023',
      message = 'Case source_case_id must point to a lineage root';
  end if;
  if v_lineage_root.version <> 1 then
    raise exception using
      errcode = '22023',
      message = 'A lineage root must use version 1';
  end if;
  if v_target.source_case_id is null and v_target.version <> 1 then
    raise exception using
      errcode = '22023',
      message = 'A root case must use version 1';
  end if;
  if v_target.source_case_id is not null and v_target.version <= v_lineage_root.version then
    raise exception using
      errcode = '22023',
      message = 'A linked case version must be newer than its source root';
  end if;

  -- The root lock is acquired before any sibling lock.  This prevents two
  -- concurrent publishes from locking different draft rows in opposite
  -- order, while the ordered sibling scan protects the entire lineage.
  for v_sibling in
    select *
      from public.cases
     where coalesce(source_case_id, id) = v_lineage_id
     order by id
     for update
  loop
    v_max_version := greatest(v_max_version, v_sibling.version);
    if v_sibling.status = 'active'::public.case_status then
      v_active_count := v_active_count + 1;
      v_active_id := v_sibling.id;
    end if;
  end loop;

  select *
    into v_target
    from public.cases
   where id = p_case_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Case does not exist';
  end if;
  if coalesce(v_target.source_case_id, v_target.id) <> v_lineage_id then
    raise exception using
      errcode = '40001',
      message = 'Case lineage changed before it could be published';
  end if;
  if v_target.status <> 'draft'::public.case_status then
    raise exception using
      errcode = 'P0001',
      message = format('Case cannot be published from status %s', v_target.status);
  end if;
  -- The lineage/version unique index catches exact duplicates.  This
  -- explicit check gives a clear conflict for a stale lower version.
  if v_target.version < v_max_version then
    raise exception using
      errcode = '55000',
      message = 'Case version is older than an existing version in its lineage';
  end if;
  if not exists (select 1 from public.case_phases where case_id = p_case_id) then
    raise exception using
      errcode = '23514',
      message = 'Case cannot be published without phases';
  end if;
  if v_active_count > 1 then
    raise exception using
      errcode = '55000',
      message = 'Cannot publish a lineage with multiple active versions';
  end if;

  if v_active_id is not null then
    update public.cases
       set status = 'superseded'::public.case_status,
           updated_at = timezone('utc', now())
     where id = v_active_id;

    -- Activate the target before moving assignments.  The assignment guard
    -- intentionally rejects rows targeting drafts, so this ordering is part
    -- of the atomic publication contract.
  end if;

  update public.cases
     set status = 'active'::public.case_status,
         published_at = v_published_at,
         updated_at = timezone('utc', now())
   where id = p_case_id
     and status = 'draft'::public.case_status
  returning * into v_target;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Case changed before it could be published';
  end if;

  if v_active_id is not null then
    if coalesce(p_move_open_assignments, true) then
      update public.class_case_assignments
         set case_id = p_case_id,
             updated_at = timezone('utc', now())
       where case_id = v_active_id
         and status = 'open';
    end if;
  end if;
  return v_target;
end;
$$;

-- Preserve the old two-argument entry point for existing SQL clients while
-- routing it through the same superseding semantics and default move policy.
create or replace function public.publish_case(
  p_case_id uuid,
  p_published_at timestamptz default timezone('utc', now())
)
returns public.cases
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  return public.publish_case(p_case_id, p_published_at, true);
end;
$$;

drop trigger if exists sessions_reject_archived_case on public.sessions;
create trigger sessions_reject_archived_case
before insert on public.sessions
for each row execute function public.reject_archived_case_session();

revoke all on function public.publish_case(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.publish_case(uuid, timestamptz, boolean) to service_role;
revoke all on function public.publish_case(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_case(uuid, timestamptz) to service_role;
revoke all on function public.reject_archived_case_session() from public, anon, authenticated;
grant execute on function public.reject_archived_case_session() to service_role;
revoke all on function public.guard_case_assignment_case() from public, anon, authenticated;
grant execute on function public.guard_case_assignment_case() to service_role;

comment on function public.publish_case(uuid, timestamptz, boolean) is
  'Publish a draft case version, supersede the prior active sibling, and optionally move open assignments in place.';

commit;
