begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

select has_column('public', 'messages', 'client_request_id', 'student messages store a client request key');
select ok(
  exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and indexname = 'messages_session_client_request_id_unique_idx'
  ),
  'request keys are unique within a session'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status,text,jsonb,jsonb)',
    'execute'
  ),
  'anonymous callers cannot commit tutor turns'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status,text,jsonb,jsonb)',
    'execute'
  ),
  'service role can commit tutor turns'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status)',
    'execute'
  ),
  'anonymous callers cannot use the legacy commit signature'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status)',
    'execute'
  ),
  'service role can use the legacy commit signature'
);

insert into public.users (id, email, display_name, role)
values
  ('12121212-1212-4121-8121-121212121201', 'idempotency-admin@test.invalid', 'Idempotency Admin', 'admin'),
  ('12121212-1212-4121-8121-121212121202', 'idempotency-student@test.invalid', 'Idempotency Student', 'student'),
  ('12121212-1212-4121-8121-121212121207', 'idempotency-professor@test.invalid', 'Idempotency Professor', 'professor');

insert into public.cases (id, slug, title, specialty, status, published_at, created_by)
values (
  '12121212-1212-4121-8121-121212121203',
  'idempotency-case',
  'Idempotency Case',
  'dentistry',
  'active',
  timezone('utc', now()),
  '12121212-1212-4121-8121-121212121201'
);

insert into public.case_phases (id, case_id, phase_order, phase_key, title, objectives, questions)
values (
  '12121212-1212-4121-8121-121212121204',
  '12121212-1212-4121-8121-121212121203',
  1,
  'observe',
  'Observe',
  array['Observe the record'],
  array['What do you notice?']
);

insert into public.classes (id, name, code, term, created_by)
values (
  '12121212-1212-4121-8121-121212121208',
  'Idempotency Test Class',
  'IDEMPOTENCY-CLASS',
  'AY2026/27',
  '12121212-1212-4121-8121-121212121207'
);

insert into public.class_memberships (class_id, user_id, role, is_lead)
values
  (
    '12121212-1212-4121-8121-121212121208',
    '12121212-1212-4121-8121-121212121207',
    'professor',
    true
  ),
  (
    '12121212-1212-4121-8121-121212121208',
    '12121212-1212-4121-8121-121212121202',
    'student',
    false
  );

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at, idempotency_key
)
values
  (
    '12121212-1212-4121-8121-121212121209',
    '12121212-1212-4121-8121-121212121208',
    '12121212-1212-4121-8121-121212121203',
    '12121212-1212-4121-8121-121212121207',
    'open',
    timezone('utc', now()) - interval '1 minute',
    'idempotency:turn:first'
  ),
  (
    '12121212-1212-4121-8121-121212121210',
    '12121212-1212-4121-8121-121212121208',
    '12121212-1212-4121-8121-121212121203',
    '12121212-1212-4121-8121-121212121207',
    'open',
    timezone('utc', now()) - interval '1 minute',
    'idempotency:turn:legacy'
  );

insert into public.sessions (id, case_id, student_id, professor_id, class_case_assignment_id, status, current_phase_id, context)
values (
  '12121212-1212-4121-8121-121212121205',
  '12121212-1212-4121-8121-121212121203',
  '12121212-1212-4121-8121-121212121202',
  '12121212-1212-4121-8121-121212121207',
  '12121212-1212-4121-8121-121212121209',
  'active',
  '12121212-1212-4121-8121-121212121204',
  '{}'::jsonb
);

insert into public.session_state (session_id, current_phase_id, state)
values (
  '12121212-1212-4121-8121-121212121205',
  '12121212-1212-4121-8121-121212121204',
  '{"version":1}'::jsonb
);

select lives_ok($$
  select * from public.commit_tutor_turn(
    '12121212-1212-4121-8121-121212121205'::uuid,
    '12121212-1212-4121-8121-121212121202'::uuid,
    'The canine is unerupted.',
    '12121212-1212-4121-8121-121212121204'::uuid,
    'What evidence supports that observation?',
    '12121212-1212-4121-8121-121212121204'::uuid,
    'formative'::public.evaluation_type,
    70,
    '{"classification":"partial","criteriaMet":["finding"],"supportLevel":1}'::jsonb,
    'Connect the finding to the next step.',
     '12121212-1212-4121-8121-121212121207'::uuid,
    '{"version":2}'::jsonb,
    1,
    '{"pausedAt":null}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '12121212-1212-4121-8121-121212121204'::uuid,
    'completed'::public.session_status,
    'turn-idempotency-1',
    '{"source":"student"}'::jsonb,
    '{"acknowledgement":"You identified the key finding.","moveType":"question"}'::jsonb
  )
$$, 'the first turn commits atomically');

select is(
  (select count(*) from public.messages where session_id = '12121212-1212-4121-8121-121212121205'::uuid and role = 'student'),
  1::bigint,
  'the first commit writes one student message'
);
select is(
  (select client_request_id from public.messages where session_id = '12121212-1212-4121-8121-121212121205'::uuid and role = 'student'),
  'turn-idempotency-1',
  'the request key is stored on the student message'
);
select is(
  (select metadata ->> 'acknowledgement' from public.messages where session_id = '12121212-1212-4121-8121-121212121205'::uuid and role = 'tutor'),
  'You identified the key finding.',
  'tutor acknowledgement metadata is preserved'
);
select is(
  (select criteria ->> 'supportLevel' from public.evaluations where session_id = '12121212-1212-4121-8121-121212121205'::uuid),
  '1',
  'structured evaluation metadata is persisted'
);

insert into public.sessions (id, case_id, student_id, professor_id, class_case_assignment_id, status, current_phase_id, context)
values (
  '12121212-1212-4121-8121-121212121206',
  '12121212-1212-4121-8121-121212121203',
  '12121212-1212-4121-8121-121212121202',
  '12121212-1212-4121-8121-121212121207',
  '12121212-1212-4121-8121-121212121210',
  'active',
  '12121212-1212-4121-8121-121212121204',
  '{}'::jsonb
);

insert into public.session_state (session_id, current_phase_id, state)
values (
  '12121212-1212-4121-8121-121212121206',
  '12121212-1212-4121-8121-121212121204',
  '{"version":1}'::jsonb
);

select lives_ok($$
  select * from public.commit_tutor_turn(
    '12121212-1212-4121-8121-121212121206'::uuid,
    '12121212-1212-4121-8121-121212121202'::uuid,
    'The canine is unerupted.',
    '12121212-1212-4121-8121-121212121204'::uuid,
    'What evidence supports that observation?'
  )
$$, 'the legacy signature remains callable with its original required arguments');

select lives_ok($$
  select * from public.commit_tutor_turn(
    '12121212-1212-4121-8121-121212121205'::uuid,
    '12121212-1212-4121-8121-121212121202'::uuid,
    'The canine is unerupted.',
    '12121212-1212-4121-8121-121212121204'::uuid,
    'What evidence supports that observation?',
    '12121212-1212-4121-8121-121212121204'::uuid,
    'formative'::public.evaluation_type,
    70,
    '{"classification":"partial"}'::jsonb,
    'Different retry payload is ignored after the idempotency match.',
    null,
    '{"version":999}'::jsonb,
    999,
    '{}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '12121212-1212-4121-8121-121212121204'::uuid,
    'completed'::public.session_status,
    'turn-idempotency-1',
    '{}'::jsonb,
    '{}'::jsonb
  )
$$, 'a final-turn retry succeeds before status/version checks');

select throws_ok($$
  select * from public.commit_tutor_turn(
    '12121212-1212-4121-8121-121212121205'::uuid,
    '12121212-1212-4121-8121-121212121202'::uuid,
    'A different answer.',
    '12121212-1212-4121-8121-121212121204'::uuid,
    'What evidence supports that observation?',
    '12121212-1212-4121-8121-121212121204'::uuid,
    'formative'::public.evaluation_type,
    70,
    '{}'::jsonb,
    'retry',
    null,
    '{}'::jsonb,
    999,
    '{}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '12121212-1212-4121-8121-121212121204'::uuid,
    'completed'::public.session_status,
    'turn-idempotency-1',
    '{}'::jsonb,
    '{}'::jsonb
  )
$$, 'P0001', 'IDEMPOTENCY_CONFLICT: client request ID was already used with different content', 'a reused key with different content is rejected');

select is(
  (select count(*) from public.messages where session_id = '12121212-1212-4121-8121-121212121205'::uuid),
  2::bigint,
  'retry does not append duplicate messages'
);

select * from finish();
rollback;
