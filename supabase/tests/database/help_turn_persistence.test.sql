begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

select ok(
  has_function_privilege(
    'service_role',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status,text,jsonb,jsonb)',
    'execute'
  ),
  'service role can commit tagged Help turns'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status,text,jsonb,jsonb)',
    'execute'
  ),
  'anonymous callers cannot commit tagged Help turns'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status)',
    'execute'
  ),
  'service role retains the legacy answer wrapper'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.commit_tutor_turn(uuid,uuid,text,uuid,text,uuid,public.evaluation_type,numeric,jsonb,text,uuid,jsonb,integer,jsonb,text[],text[],uuid,public.session_status)',
    'execute'
  ),
  'anonymous callers cannot use the legacy answer wrapper'
);

insert into public.users (id, email, display_name, role)
values
  ('23232323-2323-4232-8232-232323232301', 'help-admin@test.invalid', 'Help Admin', 'admin'),
  ('23232323-2323-4232-8232-232323232302', 'help-student@test.invalid', 'Help Student', 'student'),
  ('23232323-2323-4232-8232-232323232307', 'help-professor@test.invalid', 'Help Professor', 'professor');

insert into public.cases (id, slug, title, specialty, status, published_at, created_by)
values (
  '23232323-2323-4232-8232-232323232303',
  'help-turn-case',
  'Help Turn Case',
  'dentistry',
  'draft',
  null,
  '23232323-2323-4232-8232-232323232301'
);

insert into public.case_phases (id, case_id, phase_order, phase_key, title, objectives, questions)
values (
  '23232323-2323-4232-8232-232323232304',
  '23232323-2323-4232-8232-232323232303',
  1,
  'observe',
  'Observe',
  array['Observe the record'],
  array['What do you notice?']
);

set local role service_role;
select lives_ok(
  $$select public.publish_case('23232323-2323-4232-8232-232323232303'::uuid, timezone('utc', now()))$$,
  'the Help fixture publishes after its phase exists'
);
reset role;

insert into public.classes (id, name, code, term, created_by)
values (
  '23232323-2323-4232-8232-232323232308',
  'Help Test Class',
  'HELP-CLASS',
  'AY2026/27',
  '23232323-2323-4232-8232-232323232307'
);

insert into public.class_memberships (class_id, user_id, role, is_lead)
values
  ('23232323-2323-4232-8232-232323232308', '23232323-2323-4232-8232-232323232307', 'professor', true),
  ('23232323-2323-4232-8232-232323232308', '23232323-2323-4232-8232-232323232302', 'student', false);

insert into public.class_case_assignments (id, class_id, case_id, assigned_by, status, opens_at, idempotency_key)
values
  ('23232323-2323-4232-8232-232323232309', '23232323-2323-4232-8232-232323232308', '23232323-2323-4232-8232-232323232303', '23232323-2323-4232-8232-232323232307', 'open', timezone('utc', now()) - interval '1 minute', 'help:one'),
  ('23232323-2323-4232-8232-232323232310', '23232323-2323-4232-8232-232323232308', '23232323-2323-4232-8232-232323232303', '23232323-2323-4232-8232-232323232307', 'open', timezone('utc', now()) - interval '1 minute', 'help:two'),
  ('23232323-2323-4232-8232-232323232314', '23232323-2323-4232-8232-232323232308', '23232323-2323-4232-8232-232323232303', '23232323-2323-4232-8232-232323232307', 'open', timezone('utc', now()) - interval '1 minute', 'help:three');

insert into public.sessions (id, case_id, student_id, professor_id, class_case_assignment_id, status, current_phase_id, context)
values
  ('23232323-2323-4232-8232-232323232305', '23232323-2323-4232-8232-232323232303', '23232323-2323-4232-8232-232323232302', '23232323-2323-4232-8232-232323232307', '23232323-2323-4232-8232-232323232309', 'active', '23232323-2323-4232-8232-232323232304', '{}'::jsonb),
  ('23232323-2323-4232-8232-232323232306', '23232323-2323-4232-8232-232323232303', '23232323-2323-4232-8232-232323232302', '23232323-2323-4232-8232-232323232307', '23232323-2323-4232-8232-232323232310', 'active', '23232323-2323-4232-8232-232323232304', '{}'::jsonb),
  ('23232323-2323-4232-8232-232323232313', '23232323-2323-4232-8232-232323232303', '23232323-2323-4232-8232-232323232302', '23232323-2323-4232-8232-232323232307', '23232323-2323-4232-8232-232323232314', 'active', '23232323-2323-4232-8232-232323232304', '{}'::jsonb);

insert into public.session_state (session_id, current_phase_id, state)
values
  ('23232323-2323-4232-8232-232323232305', '23232323-2323-4232-8232-232323232304', '{"version":1}'::jsonb),
  ('23232323-2323-4232-8232-232323232306', '23232323-2323-4232-8232-232323232304', '{"version":1}'::jsonb),
  ('23232323-2323-4232-8232-232323232313', '23232323-2323-4232-8232-232323232304', '{"version":1}'::jsonb);

select lives_ok($$
  select * from public.commit_tutor_turn(
    '23232323-2323-4232-8232-232323232305'::uuid,
    '23232323-2323-4232-8232-232323232302'::uuid,
    'Requested more help',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'Here is a plan to critique. What evidence would change your view?',
    '23232323-2323-4232-8232-232323232304'::uuid,
    null::public.evaluation_type,
    null::numeric,
    null::jsonb,
    null::text,
    null::uuid,
    '{"version":2,"phaseProgress":{"1":{"supportLevel":1,"noProgressCount":0}}}'::jsonb,
    1,
    '{"pausedAt":null}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '23232323-2323-4232-8232-232323232304'::uuid,
    'active'::public.session_status,
    'help-turn-1',
    '{"messageId":"23232323-2323-4232-8232-232323232311","turnKind":"help","helpRequested":true,"phaseOrder":1,"supportLevel":1,"completedWithSupport":false,"clientRequestId":"help-turn-1"}'::jsonb,
    '{"messageId":"23232323-2323-4232-8232-232323232312","turnKind":"help","helpRequested":true,"phaseOrder":1,"supportLevel":1,"completedWithSupport":false,"clientRequestId":"help-turn-1","replyToMessageId":"23232323-2323-4232-8232-232323232311","moveType":"hypothetical"}'::jsonb
  )
$$, 'a Help turn commits without an evaluation row');

select is(
  (select count(*) from public.messages where session_id = '23232323-2323-4232-8232-232323232305'::uuid and role = 'student'),
  1::bigint,
  'Help writes one student marker'
);
select is(
  (select count(*) from public.messages where session_id = '23232323-2323-4232-8232-232323232305'::uuid and role = 'tutor'),
  1::bigint,
  'Help writes one tutor reply'
);
select is(
  (select count(*) from public.evaluations where session_id = '23232323-2323-4232-8232-232323232305'::uuid),
  0::bigint,
  'Help never creates a fake evaluation'
);
select is(
  (select state ->> 'version' from public.session_state where session_id = '23232323-2323-4232-8232-232323232305'::uuid),
  '2',
  'Help increments the state version once'
);
select is(
  (select metadata ->> 'turnKind' from public.messages where id = '23232323-2323-4232-8232-232323232311'::uuid),
  'help',
  'the marker turn kind survives persistence'
);
select is(
  (select metadata ->> 'supportLevel' from public.messages where id = '23232323-2323-4232-8232-232323232312'::uuid),
  '1',
  'the reply support snapshot survives persistence'
);
select is(
  (select metadata ->> 'replyToMessageId' from public.messages where id = '23232323-2323-4232-8232-232323232312'::uuid),
  '23232323-2323-4232-8232-232323232311',
  'the Help reply points to its marker'
);
select is(
  (select client_request_id from public.messages where id = '23232323-2323-4232-8232-232323232311'::uuid),
  'help-turn-1',
  'only the marker carries the request key'
);
select is(
  (select client_request_id from public.messages where id = '23232323-2323-4232-8232-232323232312'::uuid),
  null,
  'the tutor reply does not duplicate the request key column'
);

select lives_ok($$
  select * from public.commit_tutor_turn(
    '23232323-2323-4232-8232-232323232305'::uuid,
    '23232323-2323-4232-8232-232323232302'::uuid,
    'Requested more help',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'Ignored retry content',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'formative'::public.evaluation_type,
    0,
    '{"classification":"wrong"}'::jsonb,
    'Ignored retry evaluation',
    null::uuid,
    '{"version":999}'::jsonb,
    999,
    '{"pausedAt":"2026-10-09T00:00:00.000Z"}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '23232323-2323-4232-8232-232323232304'::uuid,
    'completed'::public.session_status,
    'help-turn-1',
    '{"turnKind":"help","helpRequested":true}'::jsonb,
    '{"turnKind":"help","helpRequested":true}'::jsonb
  )
$$, 'a duplicate Help request replays before status and version checks');
select is(
  (select count(*) from public.messages where session_id = '23232323-2323-4232-8232-232323232305'::uuid),
  2::bigint,
  'Help replay does not append messages'
);
select is(
  (select count(*) from public.evaluations where session_id = '23232323-2323-4232-8232-232323232305'::uuid),
  0::bigint,
  'Help replay still has no evaluation'
);

select throws_ok($$
  select * from public.commit_tutor_turn(
    '23232323-2323-4232-8232-232323232305'::uuid,
    '23232323-2323-4232-8232-232323232302'::uuid,
    'Requested more help',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'Answer-style retry',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'formative'::public.evaluation_type,
    70,
    '{"classification":"partial"}'::jsonb,
    'retry',
    null::uuid,
    '{"version":3}'::jsonb,
    2,
    '{}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '23232323-2323-4232-8232-232323232304'::uuid,
    'active'::public.session_status,
    'help-turn-1',
    '{"turnKind":"answer","helpRequested":false}'::jsonb,
    '{"turnKind":"answer","helpRequested":false}'::jsonb
  )
$$, 'P0001', 'IDEMPOTENCY_CONFLICT: client request ID was already used with a different operation', 'the same key cannot become an answer operation');

select throws_ok($$
  select * from public.commit_tutor_turn(
    '23232323-2323-4232-8232-232323232306'::uuid,
    '23232323-2323-4232-8232-232323232302'::uuid,
    'Requested more help',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'A reply',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'formative'::public.evaluation_type,
    0,
    '{"classification":"wrong"}'::jsonb,
    'fake Help grade',
    null::uuid,
    '{"version":2}'::jsonb,
    1,
    '{}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '23232323-2323-4232-8232-232323232304'::uuid,
    'active'::public.session_status,
    'help-turn-invalid',
    '{"messageId":"23232323-2323-4232-8232-232323232315","turnKind":"help","helpRequested":true}'::jsonb,
    '{"messageId":"23232323-2323-4232-8232-232323232316","turnKind":"help","helpRequested":true,"replyToMessageId":"23232323-2323-4232-8232-232323232315"}'::jsonb
  )
$$, '22023', 'Help turns cannot include evaluation data', 'Help rejects fake evaluation data');
select is(
  (select count(*) from public.messages where session_id = '23232323-2323-4232-8232-232323232306'::uuid),
  0::bigint,
  'rejected Help evaluation leaves no messages'
);

select throws_ok($$
  select * from public.commit_tutor_turn(
    '23232323-2323-4232-8232-232323232313'::uuid,
    '23232323-2323-4232-8232-232323232302'::uuid,
    'Requested more help',
    '23232323-2323-4232-8232-232323232304'::uuid,
    'A reply',
    '23232323-2323-4232-8232-232323232304'::uuid,
    null::public.evaluation_type,
    null::numeric,
    null::jsonb,
    null::text,
    null::uuid,
    '{"version":2}'::jsonb,
    1,
    '{}'::jsonb,
    '{}'::text[],
    '{}'::text[],
    '23232323-2323-4232-8232-232323232304'::uuid,
    'active'::public.session_status,
    'help-turn-rollback',
    '{"messageId":"23232323-2323-4232-8232-232323232317","turnKind":"help","helpRequested":true}'::jsonb,
    '{"messageId":"23232323-2323-4232-8232-232323232312","turnKind":"help","helpRequested":true,"replyToMessageId":"23232323-2323-4232-8232-232323232317"}'::jsonb
  )
$$, '23505', null, 'a failed Help insert rolls back the marker');
select is(
  (select count(*) from public.messages where session_id = '23232323-2323-4232-8232-232323232313'::uuid),
  0::bigint,
  'rollback leaves no half Help turn'
);
select is(
  (select count(*) from public.messages where session_id = '23232323-2323-4232-8232-232323232313'::uuid and client_request_id = 'help-turn-rollback'),
  0::bigint,
  'rollback leaves the request ID replayable only as a fresh request'
);

select * from finish();
rollback;
