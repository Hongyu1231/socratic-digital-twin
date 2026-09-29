-- Make student turn retries durable across serverless instances.  The request
-- key is scoped to a session, so the same client key may safely be used in a
-- different session.
alter table public.messages
  add column if not exists client_request_id text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_client_request_id_not_blank'
  ) then
    alter table public.messages
      add constraint messages_client_request_id_not_blank
      check (client_request_id is null or length(btrim(client_request_id)) > 0);
  end if;
end;
$$;

create unique index if not exists messages_session_client_request_id_unique_idx
  on public.messages (session_id, client_request_id)
  where client_request_id is not null;

comment on column public.messages.client_request_id is
  'Client-generated idempotency key for a student turn, unique within a session.';

-- New callers use this overload.  The session row lock is acquired before
-- looking at version/status, so a retry of the final turn still returns the
-- original committed turn after the session has become completed.
create or replace function public.commit_tutor_turn(
  p_session_id uuid,
  p_student_sender_id uuid,
  p_student_content text,
  p_student_phase_id uuid,
  p_ai_content text,
  p_ai_phase_id uuid,
  p_evaluation_type public.evaluation_type,
  p_evaluation_score numeric,
  p_evaluation_criteria jsonb,
  p_evaluation_feedback text,
  p_evaluator_id uuid,
  p_state jsonb,
  p_expected_version integer,
  p_session_context jsonb,
  p_facts text[],
  p_unresolved_questions text[],
  p_current_phase_id uuid,
  p_session_status public.session_status,
  p_client_request_id text,
  p_student_metadata jsonb,
  p_ai_metadata jsonb
)
returns table (
  student_message_id uuid,
  evaluation_id uuid,
  ai_message_id uuid,
  session_state_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
  v_student_sequence integer;
  v_ai_sequence integer;
  v_effective_phase_id uuid;
  v_effective_status public.session_status;
  v_student_message_id uuid;
  v_evaluation_id uuid;
  v_ai_message_id uuid;
  v_session_state_id uuid;
  v_existing_student_id uuid;
  v_existing_student_content text;
  v_existing_student_sequence integer;
  v_existing_evaluation_id uuid;
  v_existing_ai_message_id uuid;
  v_existing_state_id uuid;
  v_request_id text;
begin
  if nullif(btrim(p_student_content), '') is null then
    raise exception using errcode = '22023', message = 'Student content cannot be blank';
  end if;

  if nullif(btrim(p_ai_content), '') is null then
    raise exception using errcode = '22023', message = 'Tutor content cannot be blank';
  end if;

  if p_student_sender_id is null then
    raise exception using errcode = '22023', message = 'A student sender is required';
  end if;

  v_request_id := nullif(btrim(p_client_request_id), '');
  if p_client_request_id is not null and v_request_id is null then
    raise exception using errcode = '22023', message = 'Client request ID cannot be blank';
  end if;

  if jsonb_typeof(coalesce(p_student_metadata, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Message metadata must be JSON objects';
  end if;

  select s.*
    into v_session
    from public.sessions as s
   where s.id = p_session_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Session does not exist';
  end if;

  if v_session.student_id <> p_student_sender_id then
    raise exception using errcode = '42501', message = 'Sender is not the session student';
  end if;

  -- This is intentionally before status, pause, version and phase checks.
  -- A response lost after the database commit can therefore be retried even
  -- when that commit completed the session.
  if v_request_id is not null then
    select m.id, m.sender_id, m.content, m.sequence_no
      into v_student_message_id, v_existing_student_id, v_existing_student_content, v_existing_student_sequence
      from public.messages as m
     where m.session_id = p_session_id
       and m.role = 'student'::public.message_role
       and m.client_request_id = v_request_id;

    if found then
      if v_existing_student_id <> p_student_sender_id
         or v_existing_student_content <> p_student_content then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: client request ID was already used with different content';
      end if;

      select e.id
        into v_existing_evaluation_id
        from public.evaluations as e
       where e.session_id = p_session_id
         and e.message_id = v_student_message_id
       order by e.created_at, e.id
       limit 1;

      select m.id
        into v_existing_ai_message_id
        from public.messages as m
       where m.session_id = p_session_id
         and m.sequence_no = v_existing_student_sequence + 1
         and m.role = 'tutor'::public.message_role
       limit 1;

      select ss.id
        into v_existing_state_id
        from public.session_state as ss
       where ss.session_id = p_session_id;

      if v_existing_evaluation_id is null or v_existing_ai_message_id is null or v_existing_state_id is null then
        raise exception using errcode = 'XX000', message = 'Committed turn is missing its atomic companion rows';
      end if;

      return query
      select v_student_message_id, v_existing_evaluation_id, v_existing_ai_message_id, v_existing_state_id;
      return;
    end if;
  end if;

  if v_session.status <> 'active'::public.session_status then
    raise exception using errcode = 'P0001', message = 'Session is already complete';
  end if;

  if nullif(v_session.context ->> 'pausedAt', '') is not null then
    raise exception using errcode = 'P0001', message = 'Resume this session before submitting another answer';
  end if;

  if p_expected_version is not null and coalesce(
    (select (ss.state ->> 'version')::integer
       from public.session_state as ss
      where ss.session_id = p_session_id),
    1
  ) <> p_expected_version then
    raise exception using errcode = '40001', message = 'Session state version conflict';
  end if;

  if jsonb_typeof(coalesce(p_session_context, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Session context must be a JSON object';
  end if;

  if p_student_phase_id is not null and not exists (
    select 1
      from public.case_phases as cp
     where cp.id = p_student_phase_id
       and cp.case_id = v_session.case_id
  ) then
    raise exception using errcode = '22023', message = 'Student phase is not part of the session case';
  end if;

  if p_ai_phase_id is not null and not exists (
    select 1
      from public.case_phases as cp
     where cp.id = p_ai_phase_id
       and cp.case_id = v_session.case_id
  ) then
    raise exception using errcode = '22023', message = 'Tutor phase is not part of the session case';
  end if;

  if p_current_phase_id is not null and not exists (
    select 1
      from public.case_phases as cp
     where cp.id = p_current_phase_id
       and cp.case_id = v_session.case_id
  ) then
    raise exception using errcode = '22023', message = 'Current phase is not part of the session case';
  end if;

  if p_evaluation_criteria is null then
    p_evaluation_criteria := '{}'::jsonb;
  elsif jsonb_typeof(p_evaluation_criteria) <> 'object' then
    raise exception using errcode = '22023', message = 'Evaluation criteria must be a JSON object';
  end if;

  if p_state is null then
    p_state := '{}'::jsonb;
  elsif jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode = '22023', message = 'Session state must be a JSON object';
  end if;

  v_effective_phase_id := coalesce(
    p_current_phase_id,
    p_ai_phase_id,
    p_student_phase_id,
    v_session.current_phase_id
  );
  v_effective_status := coalesce(p_session_status, v_session.status);

  select coalesce(max(m.sequence_no), 0) + 1
    into v_student_sequence
    from public.messages as m
   where m.session_id = p_session_id;

  insert into public.messages (
    session_id,
    sender_id,
    role,
    phase_id,
    sequence_no,
    content,
    client_request_id,
    metadata
  )
  values (
    p_session_id,
    p_student_sender_id,
    'student'::public.message_role,
    p_student_phase_id,
    v_student_sequence,
    p_student_content,
    v_request_id,
    coalesce(p_student_metadata, '{}'::jsonb) || jsonb_build_object('source', 'student')
  )
  returning id into v_student_message_id;

  insert into public.evaluations (
    session_id,
    message_id,
    phase_id,
    evaluator_id,
    evaluation_type,
    score,
    criteria,
    feedback
  )
  values (
    p_session_id,
    v_student_message_id,
    p_student_phase_id,
    p_evaluator_id,
    coalesce(p_evaluation_type, 'formative'::public.evaluation_type),
    p_evaluation_score,
    p_evaluation_criteria,
    p_evaluation_feedback
  )
  returning id into v_evaluation_id;

  v_ai_sequence := v_student_sequence + 1;

  insert into public.messages (
    session_id,
    sender_id,
    role,
    phase_id,
    sequence_no,
    content,
    metadata
  )
  values (
    p_session_id,
    null,
    'tutor'::public.message_role,
    p_ai_phase_id,
    v_ai_sequence,
    p_ai_content,
    coalesce(p_ai_metadata, '{}'::jsonb) || jsonb_build_object('source', 'socratic_tutor')
  )
  returning id into v_ai_message_id;

  insert into public.session_state (
    session_id,
    current_phase_id,
    state,
    facts,
    unresolved_questions,
    updated_at
  )
  values (
    p_session_id,
    v_effective_phase_id,
    p_state,
    coalesce(p_facts, '{}'::text[]),
    coalesce(p_unresolved_questions, '{}'::text[]),
    timezone('utc', now())
  )
  on conflict (session_id) do update
    set current_phase_id = excluded.current_phase_id,
        state = excluded.state,
        facts = excluded.facts,
        unresolved_questions = excluded.unresolved_questions,
        updated_at = timezone('utc', now())
  returning id into v_session_state_id;

  update public.sessions
     set current_phase_id = v_effective_phase_id,
         status = v_effective_status,
         context = coalesce(p_session_context, '{}'::jsonb),
         ended_at = case
           when v_effective_status = 'active'::public.session_status then null
           else coalesce(ended_at, timezone('utc', now()))
         end,
         last_activity_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
   where id = p_session_id;

  return query
  select v_student_message_id, v_evaluation_id, v_ai_message_id, v_session_state_id;
end;
$$;

-- Keep the original signature callable for older deployed server code while
-- routing it through the same locked implementation.
create or replace function public.commit_tutor_turn(
  p_session_id uuid,
  p_student_sender_id uuid,
  p_student_content text,
  p_student_phase_id uuid,
  p_ai_content text,
  p_ai_phase_id uuid default null,
  p_evaluation_type public.evaluation_type default 'formative',
  p_evaluation_score numeric default null,
  p_evaluation_criteria jsonb default '{}'::jsonb,
  p_evaluation_feedback text default null,
  p_evaluator_id uuid default null,
  p_state jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_session_context jsonb default '{}'::jsonb,
  p_facts text[] default '{}'::text[],
  p_unresolved_questions text[] default '{}'::text[],
  p_current_phase_id uuid default null,
  p_session_status public.session_status default null
)
returns table (
  student_message_id uuid,
  evaluation_id uuid,
  ai_message_id uuid,
  session_state_id uuid
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  select * from public.commit_tutor_turn(
    p_session_id,
    p_student_sender_id,
    p_student_content,
    p_student_phase_id,
    p_ai_content,
    p_ai_phase_id,
    p_evaluation_type,
    p_evaluation_score,
    p_evaluation_criteria,
    p_evaluation_feedback,
    p_evaluator_id,
    p_state,
    p_expected_version,
    p_session_context,
    p_facts,
    p_unresolved_questions,
    p_current_phase_id,
    p_session_status,
    null::text,
    '{}'::jsonb,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.commit_tutor_turn(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid,
  public.session_status, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.commit_tutor_turn(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid,
  public.session_status, text, jsonb, jsonb
) to service_role;

revoke all on function public.commit_tutor_turn(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid,
  public.session_status
) from public, anon, authenticated;

grant execute on function public.commit_tutor_turn(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid,
  public.session_status
) to service_role;
