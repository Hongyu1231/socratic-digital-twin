begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select ok(
  to_regprocedure('public.create_session_for_assignment(uuid,uuid,uuid,uuid,jsonb,text)') is not null,
  'the atomic assignment session-start function exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_session_for_assignment(uuid,uuid,uuid,uuid,jsonb,text)',
    'execute'
  ),
  'service role can start assignment sessions'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_session_for_assignment(uuid,uuid,uuid,uuid,jsonb,text)',
    'execute'
  ),
  'anonymous callers cannot start assignment sessions'
);
select ok(
  to_regprocedure('public.list_staff_session_summaries(uuid,uuid,text,timestamptz,uuid,integer)') is not null,
  'the bounded staff session page function exists'
);
select ok(
  to_regprocedure('public.get_staff_session_rollup(uuid,uuid)') is not null,
  'the staff queue rollup function exists'
);
select ok(
  has_function_privilege('service_role', 'public.list_staff_session_summaries(uuid,uuid,text,timestamptz,uuid,integer)', 'execute'),
  'service role can read staff session pages'
);
select ok(
  has_function_privilege('service_role', 'public.get_staff_session_rollup(uuid,uuid)', 'execute'),
  'service role can read staff queue rollups'
);

insert into public.users (id, email, display_name, role)
values
  ('87878787-8787-4878-8878-878787878701', 'session-start-admin@test.invalid', 'Session Start Admin', 'admin'),
  ('87878787-8787-4878-8878-878787878702', 'session-start-professor@test.invalid', 'Session Start Professor', 'professor'),
  ('87878787-8787-4878-8878-878787878703', 'session-start-student@test.invalid', 'Session Start Student', 'student');

insert into public.classes (id, name, code, term, status, created_by)
values (
  '87878787-8787-4878-8878-878787878704',
  'Session Start Class',
  'SESSION-START',
  'AY2026/27',
  'active',
  '87878787-8787-4878-8878-878787878702'
);

insert into public.class_memberships (class_id, user_id, role, is_lead)
values
  ('87878787-8787-4878-8878-878787878704', '87878787-8787-4878-8878-878787878702', 'professor', true),
  ('87878787-8787-4878-8878-878787878704', '87878787-8787-4878-8878-878787878703', 'student', false);

insert into public.cases (
  id, slug, title, specialty, status, patient_context, tags, created_by,
  version, published_at, difficulty
)
values (
  '87878787-8787-4878-8878-878787878705',
  'session-start-case',
  'Session Start Case',
  'dentistry',
  'draft',
  '{}'::jsonb,
  array['session-start'],
  '87878787-8787-4878-8878-878787878701',
  1,
  null,
  'intermediate'
);

insert into public.case_phases (id, case_id, phase_order, phase_key, title, objectives, questions)
values (
  '87878787-8787-4878-8878-878787878706',
  '87878787-8787-4878-8878-878787878705',
  1,
  'observe',
  'Observe the record',
  array['Record the supplied evidence'],
  array['What do you notice?']
);

set local role service_role;
select id into temporary session_start_publish
  from public.publish_case('87878787-8787-4878-8878-878787878705'::uuid, '2026-09-30T00:00:00Z'::timestamptz);
reset role;

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at, idempotency_key
)
values (
  '87878787-8787-4878-8878-878787878707',
  '87878787-8787-4878-8878-878787878704',
  '87878787-8787-4878-8878-878787878705',
  '87878787-8787-4878-8878-878787878702',
  'open',
  '2026-01-01T00:00:00Z',
  'session-start:test'
);

set local role service_role;
create temporary table session_start_result (session_id uuid);
insert into session_start_result
select public.create_session_for_assignment(
  '87878787-8787-4878-8878-878787878703'::uuid,
  '87878787-8787-4878-8878-878787878707'::uuid,
  '87878787-8787-4878-8878-878787878705'::uuid,
  '87878787-8787-4878-8878-878787878706'::uuid,
  '{"sessionId":"","version":1,"strengths":[],"previousErrors":[]}'::jsonb,
  'What do you notice?'
);
reset role;

select ok((select session_id is not null from session_start_result), 'first start returns a session id');
select is(
  (select state ->> 'sessionId' from public.session_state where session_id = (select session_id from session_start_result)),
  (select session_id::text from session_start_result),
  'the atomic initializer stores the generated session id in learner state'
);
select is(
  (select count(*)::integer from public.messages where session_id = (select session_id from session_start_result) and sequence_no = 1 and role = 'tutor'),
  1,
  'the atomic initializer stores exactly one opening tutor message'
);

-- A retry must return the initialized row rather than create a duplicate.
set local role service_role;
insert into session_start_result
select public.create_session_for_assignment(
  '87878787-8787-4878-8878-878787878703'::uuid,
  '87878787-8787-4878-8878-878787878707'::uuid,
  '87878787-8787-4878-8878-878787878705'::uuid,
  '87878787-8787-4878-8878-878787878706'::uuid,
  '{"sessionId":"","version":1,"strengths":[],"previousErrors":[]}'::jsonb,
  'What do you notice?'
);
reset role;
select is((select count(*)::integer from session_start_result), 2, 'a retry returns a second result value');
select is((select count(distinct session_id)::integer from session_start_result), 1, 'a retry returns the same session id');
select is((select count(*)::integer from public.sessions where class_case_assignment_id = '87878787-8787-4878-8878-878787878707'::uuid), 1, 'a retry does not duplicate the session');
select is(
  (select count(*)::integer from public.messages where session_id = (select session_id from session_start_result limit 1) and sequence_no = 1),
  1,
  'a retry does not duplicate the opening message'
);

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at, idempotency_key
)
values (
  '87878787-8787-4878-8878-878787878708',
  '87878787-8787-4878-8878-878787878704',
  '87878787-8787-4878-8878-878787878705',
  '87878787-8787-4878-8878-878787878702',
  'open',
  '2026-01-01T00:00:00Z',
  'session-start:invalid-phase'
);

select throws_ok(
  $$select public.create_session_for_assignment(
      '87878787-8787-4878-8878-878787878703'::uuid,
      '87878787-8787-4878-8878-878787878708'::uuid,
      '87878787-8787-4878-8878-878787878705'::uuid,
      '87878787-8787-4878-8878-878787878799'::uuid,
      '{"sessionId":"","version":1}'::jsonb,
      'Invalid phase'
    )$$,
  '22023',
  'The opening phase is not part of the case',
  'an invalid opening phase is rejected before a partial session is committed'
);
select is(
  (select count(*)::integer from public.sessions where class_case_assignment_id = '87878787-8787-4878-8878-878787878708'::uuid),
  0,
  'the invalid phase leaves no partially initialized session'
);

set local role service_role;
select is(
  (select total from public.get_staff_session_rollup(
    '87878787-8787-4878-8878-878787878702'::uuid,
    '87878787-8787-4878-8878-878787878704'::uuid
  )),
  1::bigint,
  'staff rollup counts the full authorized queue without transcript hydration'
);
select is(
  (select count(*)::integer from public.list_staff_session_summaries(
    '87878787-8787-4878-8878-878787878702'::uuid,
    '87878787-8787-4878-8878-878787878704'::uuid,
    'all', null, null, 25
  )),
  1,
  'staff page returns the bounded session projection'
);
reset role;

select ok(
  not has_function_privilege('anon', 'public.list_staff_session_summaries(uuid,uuid,text,timestamptz,uuid,integer)', 'execute'),
  'anonymous callers cannot read staff session pages'
);
select ok(
  not has_function_privilege('anon', 'public.get_staff_session_rollup(uuid,uuid)', 'execute'),
  'anonymous callers cannot read staff queue rollups'
);

select * from finish();
rollback;
