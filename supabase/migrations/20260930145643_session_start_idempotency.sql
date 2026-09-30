-- Start or resume a student session atomically.  The application performs its
-- projection work before calling this function, while this transaction owns
-- the session/state/opening-message invariant.  A concurrent retry waits on
-- the assignment/student unique key and then returns the fully initialized
-- row created by the winning transaction.
create or replace function public.create_session_for_assignment(
  p_student_id uuid,
  p_assignment_id uuid,
  p_case_id uuid,
  p_first_phase_id uuid,
  p_initial_state jsonb,
  p_opening_content text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_assignment public.class_case_assignments%rowtype;
  v_assignment_case_id uuid;
  v_case_status public.case_status;
  v_session_id uuid;
begin
  if p_student_id is null or p_assignment_id is null or p_case_id is null or p_first_phase_id is null then
    raise exception using errcode = '22023', message = 'Session start requires a student, assignment, case, and phase';
  end if;
  if jsonb_typeof(coalesce(p_initial_state, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Initial learner state must be a JSON object';
  end if;
  if nullif(btrim(p_opening_content), '') is null then
    raise exception using errcode = '22023', message = 'Opening tutor content cannot be blank';
  end if;

  -- Match the existing session trigger's case -> assignment lock order so a
  -- publish/assignment update cannot deadlock with a start transaction.
  select a.case_id
    into v_assignment_case_id
    from public.class_case_assignments as a
   where a.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'This case assignment is not available to you';
  end if;
  select c.status
    into v_case_status
    from public.cases as c
   where c.id = v_assignment_case_id
   for share;
  select a.*
    into v_assignment
    from public.class_case_assignments as a
   where a.id = p_assignment_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'This case assignment is not available to you';
  end if;
  if not exists (
    select 1
      from public.class_memberships as cm
     where cm.class_id = v_assignment.class_id
       and cm.user_id = p_student_id
       and cm.role = 'student'::public.user_role
  ) then
    raise exception using errcode = '42501', message = 'This case assignment is not available to you';
  end if;

  -- A moved assignment must still resume its existing session on the old
  -- case.  Check this before validating the assignment's current case/status.
  select s.id
    into v_session_id
    from public.sessions as s
   where s.class_case_assignment_id = p_assignment_id
     and s.student_id = p_student_id
   for update;
  if found then
    if not exists (select 1 from public.session_state where session_id = v_session_id)
       or not exists (
         select 1
           from public.messages
          where session_id = v_session_id
            and sequence_no = 1
            and role = 'tutor'::public.message_role
       ) then
      raise exception using errcode = '55000', message = 'Existing session is incomplete and cannot be resumed';
    end if;
    return v_session_id;
  end if;

  if v_assignment.case_id <> p_case_id then
    raise exception using errcode = '22023', message = 'The assignment case does not match the requested case';
  end if;
  if v_case_status = 'archived'::public.case_status then
    raise exception using errcode = 'P0001', message = 'Archived case cannot be started';
  end if;
  if v_case_status <> 'active'::public.case_status
     and v_case_status <> 'superseded'::public.case_status then
    raise exception using errcode = 'P0001', message = 'This case is not currently available';
  end if;
  if v_assignment.status <> 'open'
     or v_assignment.opens_at > timezone('utc', now())
     or (v_assignment.due_at is not null and v_assignment.due_at <= timezone('utc', now())) then
    raise exception using errcode = 'P0001', message = 'This case assignment is not currently available';
  end if;
  if not exists (
    select 1
      from public.case_phases as cp
     where cp.id = p_first_phase_id
       and cp.case_id = p_case_id
  ) then
    raise exception using errcode = '22023', message = 'The opening phase is not part of the case';
  end if;

  insert into public.sessions (
    case_id,
    student_id,
    class_case_assignment_id,
    current_phase_id,
    context
  )
  values (
    p_case_id,
    p_student_id,
    p_assignment_id,
    p_first_phase_id,
    jsonb_build_object('reviewStatus', 'pending')
  )
  on conflict (class_case_assignment_id, student_id) do nothing
  returning id into v_session_id;

  if v_session_id is null then
    select s.id
      into v_session_id
      from public.sessions as s
     where s.class_case_assignment_id = p_assignment_id
       and s.student_id = p_student_id
     for update;
    if not found
       or not exists (select 1 from public.session_state where session_id = v_session_id)
       or not exists (
         select 1
           from public.messages
          where session_id = v_session_id
            and sequence_no = 1
            and role = 'tutor'::public.message_role
       ) then
      raise exception using errcode = '55000', message = 'Concurrent session initialization did not produce a complete session';
    end if;
    return v_session_id;
  end if;

  insert into public.session_state (
    session_id,
    current_phase_id,
    state,
    facts,
    unresolved_questions
  )
  values (
    v_session_id,
    p_first_phase_id,
    jsonb_set(p_initial_state, '{sessionId}', to_jsonb(v_session_id::text), true),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_initial_state -> 'strengths', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_initial_state -> 'previousErrors', '[]'::jsonb))), '{}'::text[])
  );

  insert into public.messages (
    session_id,
    role,
    phase_id,
    sequence_no,
    content,
    metadata
  )
  values (
    v_session_id,
    'tutor'::public.message_role,
    p_first_phase_id,
    1,
    p_opening_content,
    jsonb_build_object('source', 'socratic_tutor')
  );

  return v_session_id;
end;
$$;

revoke all on function public.create_session_for_assignment(uuid, uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.create_session_for_assignment(uuid, uuid, uuid, uuid, jsonb, text)
  to service_role;

-- Staff review queues use a bounded SQL projection rather than hydrating a
-- SessionBundle for every row.  The function applies tenancy, class, review
-- filter, and keyset cursor predicates before LIMIT.
create or replace function public.list_staff_session_summaries(
  p_professor_id uuid,
  p_class_id uuid,
  p_review_filter text,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
)
returns table (
  session_id uuid,
  case_id uuid,
  case_title text,
  case_version integer,
  student_id uuid,
  student_name text,
  assignment_id uuid,
  assignment_class_id uuid,
  class_name text,
  session_status public.session_status,
  review_status text,
  score numeric,
  created_at timestamptz,
  completed_at timestamptz,
  reviewer_id uuid,
  reviewer_name text
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
with scoped as (
  select
    s.id as session_id,
    s.case_id,
    c.title as case_title,
    c.version as case_version,
    s.student_id,
    student.display_name as student_name,
    a.id as assignment_id,
    a.class_id as assignment_class_id,
    cl.name as class_name,
    s.status as session_status,
    s.context,
    nullif(s.context ->> 'score', '')::numeric as score,
    s.created_at,
    s.ended_at as completed_at,
    s.professor_id as reviewer_id,
    reviewer.display_name as reviewer_name,
    sr.status as persisted_review_status
  from public.sessions as s
  join public.class_case_assignments as a on a.id = s.class_case_assignment_id
  join public.classes as cl on cl.id = a.class_id
  join public.cases as c on c.id = s.case_id
  join public.users as student on student.id = s.student_id
  left join public.users as reviewer on reviewer.id = s.professor_id
  left join lateral (
    select sr0.status
      from public.session_reviews as sr0
     where sr0.session_id = s.id
     order by sr0.updated_at desc
     limit 1
  ) as sr on true
  where (p_class_id is null or a.class_id = p_class_id)
    and (
      p_professor_id is null
      or exists (
        select 1
          from public.class_memberships as cm
         where cm.class_id = a.class_id
           and cm.user_id = p_professor_id
           and cm.role = 'professor'::public.user_role
      )
    )
    and (
      p_cursor_created_at is null
      or s.created_at < p_cursor_created_at
      or (s.created_at = p_cursor_created_at and s.id < p_cursor_id)
    )
), classified as (
  select
    scoped.*,
    case
      when scoped.session_status <> 'completed'::public.session_status then 'in_progress'
      when (scoped.context ->> 'reviewStatus') = 'completed' or scoped.persisted_review_status = 'approved' then 'completed'
      when scoped.reviewer_id is null then 'available'
      when p_professor_id is not null and scoped.reviewer_id = p_professor_id then 'mine'
      else 'claimed'
    end as review_state
  from scoped
)
select
  classified.session_id,
  classified.case_id,
  classified.case_title,
  classified.case_version,
  classified.student_id,
  classified.student_name,
  classified.assignment_id,
  classified.assignment_class_id,
  classified.class_name,
  classified.session_status,
  case when classified.review_state = 'completed' then 'completed'
       when classified.review_state = 'in_progress' then 'pending'
       else coalesce(classified.context ->> 'reviewStatus', 'pending')
  end as review_status,
  classified.score,
  classified.created_at,
  classified.completed_at,
  classified.reviewer_id,
  classified.reviewer_name
from classified
where p_review_filter is null
   or p_review_filter = 'all'
   or classified.review_state = p_review_filter
order by classified.created_at desc, classified.session_id desc
limit least(greatest(coalesce(p_limit, 25), 1), 50) + 1;
$$;

revoke all on function public.list_staff_session_summaries(uuid, uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_staff_session_summaries(uuid, uuid, text, timestamptz, uuid, integer)
  to service_role;

-- Full-queue statistics and per-assignment progress are aggregated in the
-- database.  No context JSON or transcript is transferred for rows outside
-- the requested page, and cursor/review filters do not distort the totals.
create or replace function public.get_staff_session_rollup(
  p_professor_id uuid,
  p_class_id uuid
)
returns table (
  total bigint,
  completed bigint,
  reviewed bigint,
  available bigint,
  mine bigint,
  claimed bigint,
  assignment_progress jsonb
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
with scoped as (
  select
    s.id,
    s.class_case_assignment_id as assignment_id,
    s.status as session_status,
    s.professor_id as reviewer_id,
    s.context,
    sr.status as persisted_review_status
  from public.sessions as s
  join public.class_case_assignments as a on a.id = s.class_case_assignment_id
  left join lateral (
    select sr0.status
      from public.session_reviews as sr0
     where sr0.session_id = s.id
     order by sr0.updated_at desc
     limit 1
  ) as sr on true
  where (p_class_id is null or a.class_id = p_class_id)
    and (
      p_professor_id is null
      or exists (
        select 1
          from public.class_memberships as cm
         where cm.class_id = a.class_id
           and cm.user_id = p_professor_id
           and cm.role = 'professor'::public.user_role
      )
    )
), classified as (
  select
    scoped.*,
    case
      when scoped.session_status <> 'completed'::public.session_status then 'in_progress'
      when (scoped.context ->> 'reviewStatus') = 'completed' or scoped.persisted_review_status = 'approved' then 'completed'
      when scoped.reviewer_id is null then 'available'
      when p_professor_id is not null and scoped.reviewer_id = p_professor_id then 'mine'
      else 'claimed'
    end as review_state
  from scoped
), stats as (
  select
    count(*) as total,
    count(*) filter (where session_status = 'completed'::public.session_status) as completed,
    count(*) filter (where review_state = 'completed') as reviewed,
    count(*) filter (where review_state = 'available') as available,
    count(*) filter (where review_state = 'mine') as mine,
    count(*) filter (where review_state = 'claimed') as claimed
  from classified
), progress as (
  select coalesce(
    jsonb_object_agg(
      assignment_id::text,
      jsonb_build_object(
        'sessionCount', session_count,
        'completedCount', completed_count
      )
    ),
    '{}'::jsonb
  ) as assignment_progress
  from (
    select assignment_id,
           count(*) as session_count,
           count(*) filter (where session_status = 'completed'::public.session_status) as completed_count
      from classified
     group by assignment_id
  ) as grouped
)
select stats.*, progress.assignment_progress
  from stats cross join progress;
$$;

revoke all on function public.get_staff_session_rollup(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_staff_session_rollup(uuid, uuid)
  to service_role;
