-- Replace a draft case header and all of its phases as one transaction.
--
-- This function deliberately runs as SECURITY INVOKER.  The repository uses
-- the server-side service_role, and the explicit role check plus the function
-- ACL make this operation unavailable to browser roles.  The parent case is
-- locked before either the header or phases are changed, so publication and
-- draft replacement serialize on the same row lock.

begin;

create or replace function public.save_case_draft(
  p_case_id uuid,
  p_title text,
  p_slug text,
  p_specialty text,
  p_presenting_complaint text,
  p_created_by uuid,
  p_source_case_id uuid,
  p_version integer,
  p_patient_context jsonb,
  p_attachments jsonb,
  p_tags text[],
  p_difficulty text,
  p_phases jsonb
)
returns public.cases
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_case public.cases%rowtype;
  v_phase_count integer;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Only service_role may save case drafts';
  end if;

  if p_case_id is null then
    raise exception using errcode = '22023', message = 'Case id is required';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception using errcode = '22023', message = 'Case title cannot be blank';
  end if;
  if nullif(btrim(p_slug), '') is null then
    raise exception using errcode = '22023', message = 'Case slug cannot be blank';
  end if;
  if nullif(btrim(p_specialty), '') is null then
    raise exception using errcode = '22023', message = 'Case specialty cannot be blank';
  end if;
  if p_created_by is null then
    raise exception using errcode = '22023', message = 'Case author is required';
  end if;
  if p_version is null or p_version < 1 then
    raise exception using errcode = '22023', message = 'Case version must be positive';
  end if;
  if p_difficulty not in ('foundation', 'intermediate', 'advanced') then
    raise exception using errcode = '22023', message = 'Case difficulty is invalid';
  end if;
  if p_patient_context is null or jsonb_typeof(p_patient_context) <> 'object' then
    raise exception using errcode = '22023', message = 'Case patient context must be an object';
  end if;
  if p_attachments is null
     or jsonb_typeof(p_attachments) <> 'array'
     or jsonb_array_length(p_attachments) > 12 then
    raise exception using errcode = '22023', message = 'Case attachments must be an array of at most 12 items';
  end if;
  if p_phases is null or jsonb_typeof(p_phases) <> 'array' then
    raise exception using errcode = '22023', message = 'Case phases must be an array';
  end if;
  v_phase_count := jsonb_array_length(p_phases);
  if v_phase_count < 1 or v_phase_count > 12 then
    raise exception using errcode = '22023', message = 'Case phases must contain between 1 and 12 items';
  end if;

  -- Lock an existing parent before checking its status.  A concurrent publish
  -- therefore either happens before this save and is rejected, or waits until
  -- this complete draft replacement commits.
  select *
    into v_case
    from public.cases
   where id = p_case_id
   for update;

  if found then
    if v_case.status <> 'draft'::public.case_status then
      raise exception using
        errcode = '55000',
        message = format('Case cannot be saved from status %s', v_case.status);
    end if;

    update public.cases
       set title = p_title,
           slug = p_slug,
           specialty = p_specialty,
           presenting_complaint = p_presenting_complaint,
           status = 'draft'::public.case_status,
           patient_context = p_patient_context,
           tags = coalesce(p_tags, '{}'::text[]),
           created_by = p_created_by,
           source_case_id = p_source_case_id,
           version = p_version,
           published_at = null,
           attachments = p_attachments,
           difficulty = p_difficulty,
           updated_at = timezone('utc', now())
     where id = p_case_id
     returning * into v_case;
  else
    insert into public.cases (
      id,
      slug,
      title,
      specialty,
      presenting_complaint,
      status,
      patient_context,
      tags,
      created_by,
      source_case_id,
      version,
      published_at,
      attachments,
      difficulty
    ) values (
      p_case_id,
      p_slug,
      p_title,
      p_specialty,
      p_presenting_complaint,
      'draft'::public.case_status,
      p_patient_context,
      coalesce(p_tags, '{}'::text[]),
      p_created_by,
      p_source_case_id,
      p_version,
      null,
      p_attachments,
      p_difficulty
    )
    returning * into v_case;
  end if;

  -- Both statements are inside this function transaction.  If any phase row
  -- fails a constraint, the header update and deletion are rolled back too.
  delete from public.case_phases where case_id = p_case_id;

  insert into public.case_phases (
    id,
    case_id,
    phase_order,
    phase_key,
    title,
    objectives,
    questions,
    teaching_notes,
    expected_findings,
    metadata
  )
  select
    coalesce(nullif(btrim(raw.id), '')::uuid, gen_random_uuid()),
    p_case_id,
    raw.phase_order,
    raw.phase_key,
    raw.title,
    raw.objectives,
    raw.questions,
    raw.teaching_notes,
    coalesce(raw.expected_findings, '{}'::jsonb),
    coalesce(raw.metadata, '{}'::jsonb)
    from jsonb_to_recordset(p_phases) as raw(
      id text,
      phase_order integer,
      phase_key text,
      title text,
      objectives text[],
      questions text[],
      teaching_notes text,
      expected_findings jsonb,
      metadata jsonb
    )
   order by raw.phase_order;

  return v_case;
end;
$$;

revoke all on function public.save_case_draft(uuid, text, text, text, text, uuid, uuid, integer, jsonb, jsonb, text[], text, jsonb) from public, anon, authenticated;
grant execute on function public.save_case_draft(uuid, text, text, text, text, uuid, uuid, integer, jsonb, jsonb, text[], text, jsonb) to service_role;

comment on function public.save_case_draft(uuid, text, text, text, text, uuid, uuid, integer, jsonb, jsonb, text[], text, jsonb) is
  'Atomically replace a service-role draft case and its phases while holding the parent case lock.';

commit;
