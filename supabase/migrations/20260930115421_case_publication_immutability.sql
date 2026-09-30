-- Publication state machine and immutable published content.
--
-- This migration is intentionally separate from the column/backfill migration
-- immediately before it.  A case is editable while draft.  The only allowed
-- publication transitions are draft -> active, draft -> archived, and
-- active -> archived.  Archived rows are terminal.  Published case and phase
-- content can only be changed by an explicitly privileged seed session using
-- SET LOCAL app.allow_published_case_writes = 'true'.

begin;

create or replace function public.published_write_bypass_enabled()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select current_setting('app.allow_published_case_writes', true) = 'true'
     and current_user in ('postgres', 'service_role', 'supabase_admin');
$$;

-- A direct SET of the custom GUC is not an authorization boundary: the
-- trigger checks current_user as well as the setting.  Keep this helper
-- trigger-only so untrusted Data API roles cannot call it as an RPC.
revoke all on function public.published_write_bypass_enabled() from public, anon, authenticated;
grant execute on function public.published_write_bypass_enabled() to service_role;

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
    -- New cases must enter as unpublished drafts.  Seed/reset transactions
    -- can explicitly opt into published fixtures through the privileged
    -- bypass above; ordinary callers must build phases, then publish.
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

  -- The executor already holds the row lock for UPDATE.  Taking it
  -- explicitly documents the serialization point shared with phase writes.
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
     and new.status = 'archived'::public.case_status
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
    -- Lock the parent before observing its status.  This orders a concurrent
    -- phase insert against a publish update: either the phase is committed in
    -- the draft before publication, or it sees active and is rejected.
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
    -- by the time PostgreSQL invokes the cascade trigger, so allow that one
    -- path; published case deletion is rejected by the case trigger first.
    if found and old_status <> 'draft'::public.case_status then
      raise exception using
        errcode = '55000',
        message = 'Published case phases are immutable';
    end if;
    return old;
  end if;

  -- Lock both possible parents in a deterministic order.  Besides protecting
  -- a phase move between cases, this prevents a concurrent publication from
  -- observing a phase that is moved after its parent status check.
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

-- A conditional publish RPC gives the API one unambiguous database-side
-- operation.  The repository may still use an equivalent conditional update
-- during the compatibility rollout.
create or replace function public.publish_case(
  p_case_id uuid,
  p_published_at timestamptz default timezone('utc', now())
)
returns public.cases
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  published_case public.cases%rowtype;
  current_status public.case_status;
begin
  if p_case_id is null then
    raise exception using errcode = '22023', message = 'Case id is required';
  end if;

  -- Lock the parent while checking phases.  The phase trigger takes this same
  -- lock, so publication cannot race a phase insert between the check and the
  -- status transition.
  select status
    into current_status
    from public.cases
   where id = p_case_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Case does not exist';
  end if;
  if current_status <> 'draft'::public.case_status then
    raise exception using
      errcode = 'P0001',
      message = format('Case cannot be published from status %s', current_status);
  end if;
  if not exists (select 1 from public.case_phases where case_id = p_case_id) then
    raise exception using
      errcode = 'P0001',
      message = 'Case cannot be published without phases';
  end if;

  update public.cases
     set status = 'active'::public.case_status,
         published_at = coalesce(p_published_at, timezone('utc', now()))
   where id = p_case_id
     and status = 'draft'::public.case_status
  returning * into published_case;

  if found then
    return published_case;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'Case changed before it could be published';
end;
$$;

drop trigger if exists cases_guard_publication_contract on public.cases;
create trigger cases_guard_publication_contract
before insert or update or delete on public.cases
for each row execute function public.guard_case_publication_contract();

drop trigger if exists case_phases_guard_publication_contract on public.case_phases;
create trigger case_phases_guard_publication_contract
before insert or update or delete on public.case_phases
for each row execute function public.guard_case_phase_publication_contract();

revoke all on function public.guard_case_publication_contract() from public, anon, authenticated;
revoke all on function public.guard_case_phase_publication_contract() from public, anon, authenticated;
revoke all on function public.publish_case(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.guard_case_publication_contract() to service_role;
grant execute on function public.guard_case_phase_publication_contract() to service_role;
grant execute on function public.publish_case(uuid, timestamptz) to service_role;

commit;
