-- Persist the ungraded Help operation as a typed message pair.  The existing
-- answer implementation is retained under a private-in-practice helper so
-- deployed answer callers keep their exact 21-argument and 18-argument RPC
-- contracts.  The public 21-argument function adds the Help branch and keeps
-- the request lookup ahead of status/version checks for replay.

alter function public.commit_tutor_turn(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid,
  public.session_status, text, jsonb, jsonb
) rename to commit_tutor_turn_answer_legacy;

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
  v_turn_kind text;
  v_student_turn_kind text;
  v_ai_turn_kind text;
  v_student_help_requested boolean;
  v_ai_help_requested boolean;
  v_request_id text;
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
  v_existing_turn_kind text;
  v_existing_evaluation_id uuid;
  v_existing_ai_message_id uuid;
  v_existing_state_id uuid;
  v_existing_ai_metadata jsonb;
  v_requested_student_message_id uuid;
  v_requested_ai_message_id uuid;
  v_current_version integer;
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

  if jsonb_typeof(coalesce(p_student_metadata, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_ai_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Message metadata must be JSON objects';
  end if;

  if (p_student_metadata ? 'helpRequested')
     and jsonb_typeof(p_student_metadata -> 'helpRequested') <> 'boolean' then
    raise exception using errcode = '22023', message = 'helpRequested must be a boolean';
  end if;
  if (p_ai_metadata ? 'helpRequested')
     and jsonb_typeof(p_ai_metadata -> 'helpRequested') <> 'boolean' then
    raise exception using errcode = '22023', message = 'helpRequested must be a boolean';
  end if;

  v_student_turn_kind := coalesce(nullif(p_student_metadata ->> 'turnKind', ''), 'answer');
  v_ai_turn_kind := coalesce(nullif(p_ai_metadata ->> 'turnKind', ''), v_student_turn_kind);
  if v_student_turn_kind not in ('answer', 'help')
     or v_ai_turn_kind not in ('answer', 'help')
     or v_student_turn_kind <> v_ai_turn_kind then
    raise exception using errcode = '22023', message = 'Message turn kind must match answer or help';
  end if;
  v_turn_kind := v_student_turn_kind;
  v_student_help_requested := coalesce((p_student_metadata ->> 'helpRequested')::boolean, v_turn_kind = 'help');
  v_ai_help_requested := coalesce((p_ai_metadata ->> 'helpRequested')::boolean, v_turn_kind = 'help');
  if v_student_help_requested <> v_ai_help_requested then
    raise exception using errcode = '22023', message = 'Student and tutor Help metadata must match';
  end if;
  if v_turn_kind = 'answer' and v_student_help_requested then
    raise exception using errcode = '22023', message = 'Answer turns cannot set helpRequested to true';
  end if;

  v_request_id := nullif(btrim(p_client_request_id), '');
  if p_client_request_id is not null and v_request_id is null then
    raise exception using errcode = '22023', message = 'Client request ID cannot be blank';
  end if;

  -- Lock before looking up the request. A concurrent retry waits here and
  -- then sees the first request's committed marker and companion rows.
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

  -- Replay is intentionally before status, pause, version and eligibility
  -- checks.  A Help turn has no evaluation row, so its two messages and state
  -- row are the completeness check instead of an evaluation foreign key.
  if v_request_id is not null then
    select m.id, m.sender_id, m.content, m.sequence_no,
           coalesce(nullif(m.metadata ->> 'turnKind', ''), 'answer')
      into v_student_message_id, v_existing_student_id, v_existing_student_content,
           v_existing_student_sequence, v_existing_turn_kind
      from public.messages as m
     where m.session_id = p_session_id
       and m.role = 'student'::public.message_role
       and m.client_request_id = v_request_id;

    if found then
      if v_existing_turn_kind <> v_turn_kind then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: client request ID was already used with a different operation';
      elsif v_existing_student_id <> p_student_sender_id
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

      select m.id, m.metadata
        into v_existing_ai_message_id, v_existing_ai_metadata
        from public.messages as m
       where m.session_id = p_session_id
         and m.sequence_no = v_existing_student_sequence + 1
         and m.role = 'tutor'::public.message_role
       limit 1;

      select ss.id
        into v_existing_state_id
        from public.session_state as ss
       where ss.session_id = p_session_id;

      if v_existing_ai_message_id is null or v_existing_state_id is null then
        raise exception using errcode = 'XX000', message = 'Committed turn is missing its atomic companion rows';
      end if;

      if v_existing_turn_kind = 'help' then
        if v_existing_evaluation_id is not null
           or coalesce(nullif(v_existing_ai_metadata ->> 'turnKind', ''), 'answer') <> 'help'
           or coalesce((v_existing_ai_metadata ->> 'helpRequested')::boolean, false) is not true
           or (v_existing_ai_metadata ->> 'replyToMessageId') is distinct from v_student_message_id::text then
          raise exception using errcode = 'XX000', message = 'Committed Help turn is missing its atomic companion rows';
        end if;
      elsif v_existing_evaluation_id is null then
        raise exception using errcode = 'XX000', message = 'Committed answer turn is missing its evaluation row';
      end if;

      return query
      select v_student_message_id, v_existing_evaluation_id, v_existing_ai_message_id, v_existing_state_id;
      return;
    end if;
  end if;

  if v_turn_kind = 'help' then
    if p_student_metadata ->> 'turnKind' <> 'help'
       or p_ai_metadata ->> 'turnKind' <> 'help'
       or p_student_metadata ->> 'helpRequested' <> 'true'
       or p_ai_metadata ->> 'helpRequested' <> 'true' then
      raise exception using errcode = '22023', message = 'Help turns must set helpRequested to true';
    end if;
    if p_student_content <> 'Requested more help' then
      raise exception using errcode = '22023', message = 'Help marker content is server-generated';
    end if;
    if p_client_request_id is null or v_request_id is null then
      raise exception using errcode = '22023', message = 'Help turns require a client request ID';
    end if;
    if p_evaluation_type is not null
       or p_evaluation_score is not null
       or p_evaluation_criteria is not null
       or p_evaluation_feedback is not null
       or p_evaluator_id is not null then
      raise exception using errcode = '22023', message = 'Help turns cannot include evaluation data';
    end if;
    -- The engine normally supplies both message ids. Direct RPC callers may
    -- omit them; in that case use a valid reply target when supplied or let
    -- the database generate both ids, then write the actual marker id into
    -- the reply metadata below.
    if nullif(p_student_metadata ->> 'messageId', '') is not null
       and (p_student_metadata ->> 'messageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Help student message ID must be a valid UUID';
    end if;
    if nullif(p_ai_metadata ->> 'messageId', '') is not null
       and (p_ai_metadata ->> 'messageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Help tutor message ID must be a valid UUID';
    end if;
    if nullif(p_ai_metadata ->> 'replyToMessageId', '') is not null
       and (p_ai_metadata ->> 'replyToMessageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Help reply target must be a valid UUID';
    end if;
    v_requested_student_message_id := coalesce(
      nullif(p_student_metadata ->> 'messageId', '')::uuid,
      nullif(p_ai_metadata ->> 'replyToMessageId', '')::uuid,
      gen_random_uuid()
    );
    v_requested_ai_message_id := coalesce(
      nullif(p_ai_metadata ->> 'messageId', '')::uuid,
      gen_random_uuid()
    );
    if nullif(p_ai_metadata ->> 'replyToMessageId', '') is not null
       and p_ai_metadata ->> 'replyToMessageId' <> v_requested_student_message_id::text then
      raise exception using errcode = '22023', message = 'Help reply must reference its marker';
    end if;
    if coalesce(nullif(p_ai_metadata ->> 'clientRequestId', ''), v_request_id) <> v_request_id
       or coalesce(nullif(p_student_metadata ->> 'clientRequestId', ''), v_request_id) <> v_request_id then
      raise exception using errcode = '22023', message = 'Help metadata must carry the client request ID';
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
    select 1 from public.case_phases as cp
     where cp.id = p_student_phase_id and cp.case_id = v_session.case_id
  ) then
    raise exception using errcode = '22023', message = 'Student phase is not part of the session case';
  end if;
  if p_ai_phase_id is not null and not exists (
    select 1 from public.case_phases as cp
     where cp.id = p_ai_phase_id and cp.case_id = v_session.case_id
  ) then
    raise exception using errcode = '22023', message = 'Tutor phase is not part of the session case';
  end if;
  if p_current_phase_id is not null and not exists (
    select 1 from public.case_phases as cp
     where cp.id = p_current_phase_id and cp.case_id = v_session.case_id
  ) then
    raise exception using errcode = '22023', message = 'Current phase is not part of the session case';
  end if;

  if v_turn_kind = 'help' and coalesce(p_session_status, v_session.status) <> 'active'::public.session_status then
    raise exception using errcode = '22023', message = 'Help turns cannot complete a session';
  end if;

  if v_turn_kind = 'answer' then
    -- Delegate the unchanged answer implementation after the outer replay
    -- check. The row lock is re-entrant within this transaction.
    return query
    select * from public.commit_tutor_turn_answer_legacy(
      p_session_id,
      p_student_sender_id,
      p_student_content,
      p_student_phase_id,
      p_ai_content,
      p_ai_phase_id,
      p_evaluation_type,
      p_evaluation_score,
      coalesce(p_evaluation_criteria, '{}'::jsonb),
      p_evaluation_feedback,
      p_evaluator_id,
      coalesce(p_state, '{}'::jsonb),
      p_expected_version,
      coalesce(p_session_context, '{}'::jsonb),
      coalesce(p_facts, '{}'::text[]),
      coalesce(p_unresolved_questions, '{}'::text[]),
      p_current_phase_id,
      p_session_status,
      v_request_id,
      coalesce(p_student_metadata, '{}'::jsonb),
      coalesce(p_ai_metadata, '{}'::jsonb)
    );
    return;
  end if;

  if p_state is null then
    p_state := '{}'::jsonb;
  elsif jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode = '22023', message = 'Session state must be a JSON object';
  end if;

  -- Help changes support state exactly once. The engine supplies the complete
  -- next state; this guard prevents a caller from committing an unversioned or
  -- multi-step Help mutation while retaining legacy answer compatibility.
  v_current_version := coalesce(
    (select (ss.state ->> 'version')::integer
       from public.session_state as ss
      where ss.session_id = p_session_id),
    1
  );
  if p_expected_version is not null then
    if jsonb_typeof(p_state -> 'version') <> 'number'
       or (p_state ->> 'version') !~ '^[0-9]+$'
       or (p_state ->> 'version')::integer <> p_expected_version + 1 then
      raise exception using errcode = '22023', message = 'Help turns must increment session state version exactly once';
    end if;
  elsif jsonb_typeof(p_state -> 'version') <> 'number'
     or (p_state ->> 'version') !~ '^[0-9]+$'
     or (p_state ->> 'version')::integer <> v_current_version + 1 then
    raise exception using errcode = '22023', message = 'Help turns must increment session state version exactly once';
  end if;

  v_effective_phase_id := coalesce(p_current_phase_id, p_ai_phase_id, p_student_phase_id, v_session.current_phase_id);
  v_effective_status := coalesce(p_session_status, v_session.status);
  if v_turn_kind = 'help' and v_effective_phase_id is distinct from v_session.current_phase_id then
    raise exception using errcode = '22023', message = 'Help turns cannot advance the session phase';
  end if;

  select coalesce(max(m.sequence_no), 0) + 1
    into v_student_sequence
    from public.messages as m
   where m.session_id = p_session_id;

  insert into public.messages (
    id, session_id, sender_id, role, phase_id, sequence_no, content, client_request_id, metadata
  )
  values (
    v_requested_student_message_id,
    p_session_id,
    p_student_sender_id,
    'student'::public.message_role,
    p_student_phase_id,
    v_student_sequence,
    'Requested more help',
    v_request_id,
    coalesce(p_student_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source', 'student',
        'turnKind', 'help',
        'helpRequested', true,
        'clientRequestId', v_request_id
      )
  )
  returning id into v_student_message_id;

  v_ai_sequence := v_student_sequence + 1;
  insert into public.messages (
    id, session_id, sender_id, role, phase_id, sequence_no, content, metadata
  )
  values (
    v_requested_ai_message_id,
    p_session_id,
    null,
    'tutor'::public.message_role,
    p_ai_phase_id,
    v_ai_sequence,
    p_ai_content,
    coalesce(p_ai_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source', 'socratic_tutor',
        'turnKind', 'help',
        'helpRequested', true,
        'clientRequestId', v_request_id,
        'replyToMessageId', v_student_message_id::text
      )
  )
  returning id into v_ai_message_id;

  insert into public.session_state (
    session_id, current_phase_id, state, facts, unresolved_questions, updated_at
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

  return query select v_student_message_id, null::uuid, v_ai_message_id, v_session_state_id;
end;
$$;

-- Keep the old positional wrapper callable. It is explicitly an answer call;
-- no fake evaluation or Help metadata is synthesized for it.
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
    jsonb_build_object('turnKind', 'answer', 'helpRequested', false),
    jsonb_build_object('turnKind', 'answer', 'helpRequested', false)
  );
end;
$$;

-- Renaming the old function preserves its grants, but make the intended
-- restricted surface explicit for both the helper and the two public overloads.
revoke all on function public.commit_tutor_turn_answer_legacy(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid,
  public.session_status, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.commit_tutor_turn_answer_legacy(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid,
  public.session_status, text, jsonb, jsonb
) to service_role;

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
