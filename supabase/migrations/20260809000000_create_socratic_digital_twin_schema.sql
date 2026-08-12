-- Socratic Digital Twin tutor POC schema.
--
-- The public schema is deliberately not exposed to anon/authenticated by this
-- migration.  Every table has RLS enabled as a second line of defence, while
-- the server-side service_role is granted the privileges used by the POC.
-- Functions execute as the invoker; no privilege escalation is used.

begin;

create type public.user_role as enum (
  'student',
  'professor',
  'admin'
);

create type public.case_status as enum (
  'draft',
  'active',
  'archived'
);

create type public.session_status as enum (
  'active',
  'completed',
  'abandoned'
);

create type public.message_role as enum (
  'student',
  'tutor',
  'assistant',
  'system'
);

create type public.evaluation_type as enum (
  'formative',
  'summative',
  'rubric',
  'milestone',
  'safety',
  'overall'
);

create type public.review_status as enum (
  'pending',
  'approved',
  'rejected',
  'needs_revision'
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  -- Optional link to Supabase Auth.  The POC can be seeded without creating
  -- auth.users rows; production sign-in can populate this column.
  auth_user_id uuid unique references auth.users (id) on delete set null,
  email text not null unique,
  display_name text not null,
  role public.user_role not null,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint users_email_not_blank check (length(btrim(email)) > 3),
  constraint users_display_name_not_blank check (length(btrim(display_name)) > 0),
  constraint users_profile_object check (jsonb_typeof(profile) = 'object'),
  constraint users_timestamps_order check (updated_at >= created_at)
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  specialty text not null,
  diagnosis text,
  presenting_complaint text,
  status public.case_status not null default 'draft',
  patient_context jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cases_slug_not_blank check (length(btrim(slug)) > 0),
  constraint cases_title_not_blank check (length(btrim(title)) > 0),
  constraint cases_specialty_not_blank check (length(btrim(specialty)) > 0),
  constraint cases_patient_context_object check (jsonb_typeof(patient_context) = 'object'),
  constraint cases_tags_no_nulls check (array_position(tags, null) is null),
  constraint cases_timestamps_order check (updated_at >= created_at)
);

create table public.case_phases (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  phase_order integer not null,
  phase_key text not null,
  title text not null,
  objectives text[] not null,
  questions text[] not null,
  teaching_notes text,
  expected_findings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint case_phases_order_positive check (phase_order > 0),
  constraint case_phases_key_not_blank check (length(btrim(phase_key)) > 0),
  constraint case_phases_title_not_blank check (length(btrim(title)) > 0),
  constraint case_phases_objectives_required check (cardinality(objectives) > 0),
  constraint case_phases_questions_required check (cardinality(questions) > 0),
  constraint case_phases_objectives_no_nulls check (array_position(objectives, null) is null),
  constraint case_phases_questions_no_nulls check (array_position(questions, null) is null),
  constraint case_phases_expected_findings_object check (jsonb_typeof(expected_findings) = 'object'),
  constraint case_phases_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint case_phases_timestamps_order check (updated_at >= created_at),
  constraint case_phases_case_order_unique unique (case_id, phase_order),
  constraint case_phases_case_key_unique unique (case_id, phase_key)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete restrict,
  student_id uuid not null references public.users (id) on delete restrict,
  professor_id uuid references public.users (id) on delete set null,
  status public.session_status not null default 'active',
  current_phase_id uuid references public.case_phases (id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  last_activity_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sessions_context_object check (jsonb_typeof(context) = 'object'),
  constraint sessions_timestamps_order check (updated_at >= created_at),
  constraint sessions_activity_after_start check (last_activity_at >= started_at),
  constraint sessions_end_status_consistent check (
    (status = 'active' and ended_at is null)
    or (status in ('completed', 'abandoned') and ended_at is not null)
  ),
  constraint sessions_end_after_start check (ended_at is null or ended_at >= started_at)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  sender_id uuid references public.users (id) on delete set null,
  role public.message_role not null,
  phase_id uuid references public.case_phases (id) on delete set null,
  sequence_no integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint messages_sequence_positive check (sequence_no > 0),
  constraint messages_content_not_blank check (length(btrim(content)) > 0),
  constraint messages_student_has_sender check (
    role <> 'student' or sender_id is not null
  ),
  constraint messages_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint messages_timestamps_order check (updated_at >= created_at),
  constraint messages_session_sequence_unique unique (session_id, sequence_no)
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  phase_id uuid references public.case_phases (id) on delete set null,
  evaluator_id uuid references public.users (id) on delete set null,
  evaluation_type public.evaluation_type not null default 'formative',
  score numeric(5, 2),
  criteria jsonb not null default '{}'::jsonb,
  feedback text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint evaluations_target_required check (message_id is not null or phase_id is not null),
  constraint evaluations_score_range check (score is null or (score >= 0 and score <= 100)),
  constraint evaluations_criteria_object check (jsonb_typeof(criteria) = 'object'),
  constraint evaluations_timestamps_order check (updated_at >= created_at)
);

create table public.session_state (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  current_phase_id uuid references public.case_phases (id) on delete set null,
  state jsonb not null default '{}'::jsonb,
  facts text[] not null default '{}'::text[],
  unresolved_questions text[] not null default '{}'::text[],
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint session_state_state_object check (jsonb_typeof(state) = 'object'),
  constraint session_state_facts_no_nulls check (array_position(facts, null) is null),
  constraint session_state_questions_no_nulls check (array_position(unresolved_questions, null) is null),
  constraint session_state_timestamps_order check (updated_at >= created_at)
);

create table public.answer_reviews (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  reviewer_id uuid not null references public.users (id) on delete restrict,
  status public.review_status not null default 'pending',
  score numeric(5, 2),
  comments text,
  rubric jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint answer_reviews_score_range check (score is null or (score >= 0 and score <= 100)),
  constraint answer_reviews_rubric_object check (jsonb_typeof(rubric) = 'object'),
  constraint answer_reviews_timestamps_order check (updated_at >= created_at),
  constraint answer_reviews_message_reviewer_unique unique (message_id, reviewer_id)
);

create table public.session_reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  reviewer_id uuid not null references public.users (id) on delete restrict,
  status public.review_status not null default 'pending',
  overall_score numeric(5, 2),
  summary text,
  strengths text[] not null default '{}'::text[],
  improvement_areas text[] not null default '{}'::text[],
  rubric jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint session_reviews_score_range check (
    overall_score is null or (overall_score >= 0 and overall_score <= 100)
  ),
  constraint session_reviews_strengths_no_nulls check (array_position(strengths, null) is null),
  constraint session_reviews_improvement_areas_no_nulls check (array_position(improvement_areas, null) is null),
  constraint session_reviews_rubric_object check (jsonb_typeof(rubric) = 'object'),
  constraint session_reviews_timestamps_order check (updated_at >= created_at),
  constraint session_reviews_session_reviewer_unique unique (session_id, reviewer_id)
);

-- Foreign-key and common lookup indexes keep the RLS/relationship paths cheap.
create index users_role_idx on public.users (role);
create index cases_created_by_idx on public.cases (created_by);
create index cases_status_idx on public.cases (status);
create index case_phases_case_idx on public.case_phases (case_id);
create index sessions_case_idx on public.sessions (case_id);
create index sessions_student_idx on public.sessions (student_id);
create index sessions_professor_idx on public.sessions (professor_id);
create index sessions_status_idx on public.sessions (status);
create index sessions_last_activity_idx on public.sessions (last_activity_at desc);
create index messages_session_idx on public.messages (session_id);
create index messages_phase_idx on public.messages (phase_id);
create index evaluations_session_idx on public.evaluations (session_id);
create index evaluations_message_idx on public.evaluations (message_id);
create index evaluations_phase_idx on public.evaluations (phase_id);
create index evaluations_evaluator_idx on public.evaluations (evaluator_id);
create index session_state_phase_idx on public.session_state (current_phase_id);
create index answer_reviews_reviewer_idx on public.answer_reviews (reviewer_id);
create index answer_reviews_status_idx on public.answer_reviews (status);
create index session_reviews_reviewer_idx on public.session_reviews (reviewer_id);
create index session_reviews_status_idx on public.session_reviews (status);

-- RLS is enabled everywhere in the exposed public schema.  There are no
-- anon/authenticated policies or grants: access is intentionally service-only
-- for this POC, and the absence of policies keeps future accidental grants
-- fail-closed as well.
alter table public.users enable row level security;
alter table public.cases enable row level security;
alter table public.case_phases enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.evaluations enable row level security;
alter table public.session_state enable row level security;
alter table public.answer_reviews enable row level security;
alter table public.session_reviews enable row level security;

revoke all on table public.users from public, anon, authenticated;
revoke all on table public.cases from public, anon, authenticated;
revoke all on table public.case_phases from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
revoke all on table public.evaluations from public, anon, authenticated;
revoke all on table public.session_state from public, anon, authenticated;
revoke all on table public.answer_reviews from public, anon, authenticated;
revoke all on table public.session_reviews from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on table public.users to service_role;
grant all on table public.cases to service_role;
grant all on table public.case_phases to service_role;
grant all on table public.sessions to service_role;
grant all on table public.messages to service_role;
grant all on table public.evaluations to service_role;
grant all on table public.session_state to service_role;
grant all on table public.answer_reviews to service_role;
grant all on table public.session_reviews to service_role;

-- Commit one Socratic turn atomically.  The function executes as its invoker and
-- callable only by the server-side service_role.  Locking the session row
-- serializes sequence allocation for concurrent tutor requests.
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
    metadata
  )
  values (
    p_session_id,
    p_student_sender_id,
    'student'::public.message_role,
    p_student_phase_id,
    v_student_sequence,
    p_student_content,
    jsonb_build_object('source', 'student')
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
    jsonb_build_object('source', 'socratic_tutor')
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

revoke all on function public.commit_tutor_turn(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid, public.session_status
) from public, anon, authenticated;

grant execute on function public.commit_tutor_turn(
  uuid, uuid, text, uuid, text, uuid, public.evaluation_type, numeric,
  jsonb, text, uuid, jsonb, integer, jsonb, text[], text[], uuid, public.session_status
) to service_role;

commit;
