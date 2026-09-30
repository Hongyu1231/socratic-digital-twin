begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

insert into public.users (id, email, display_name, role)
values
  ('55555555-5555-4555-8555-555555555501', 'superseded-admin@test.invalid', 'Superseded Admin', 'admin'),
  ('55555555-5555-4555-8555-555555555502', 'superseded-student@test.invalid', 'Superseded Student', 'student');

insert into public.classes (id, name, code, term, status, created_by)
values (
  '55555555-5555-4555-8555-555555555503',
  'Superseded Contract Class',
  'SUP-CASE-1',
  'AY2026/27',
  'active',
  '55555555-5555-4555-8555-555555555501'
);

insert into public.class_memberships (class_id, user_id, role, is_lead)
values (
  '55555555-5555-4555-8555-555555555503',
  '55555555-5555-4555-8555-555555555502',
  'student',
  false
);

-- Seed the already-published root through the same narrowly scoped bypass used
-- by reset/fixture migrations.  The normal publication paths below run with
-- the bypass disabled.
set local app.allow_published_case_writes = 'true';
insert into public.cases (
  id, slug, title, specialty, status, patient_context, tags, created_by,
  version, published_at, difficulty
)
values (
  '55555555-5555-4555-8555-555555555504',
  'superseded-root-v1',
  'Superseded root v1',
  'dentistry',
  'active',
  '{}'::jsonb,
  array['root'],
  '55555555-5555-4555-8555-555555555501',
  1,
  '2026-09-30T00:00:00Z',
  'intermediate'
);

insert into public.case_phases (
  id, case_id, phase_order, phase_key, title, objectives, questions
)
values (
  '55555555-5555-4555-8555-555555555505',
  '55555555-5555-4555-8555-555555555504',
  1,
  'observe',
  'Observe the root',
  array['Record the evidence'],
  array['What do you notice?']
);
set local app.allow_published_case_writes = 'false';

insert into public.cases (
  id, slug, title, specialty, status, patient_context, tags, created_by,
  source_case_id, version, published_at, difficulty
)
values (
  '55555555-5555-4555-8555-555555555506',
  'superseded-root-v2',
  'Superseded root v2',
  'dentistry',
  'draft',
  '{}'::jsonb,
  array['new'],
  '55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555504',
  2,
  null,
  'advanced'
);

insert into public.case_phases (
  id, case_id, phase_order, phase_key, title, objectives, questions
)
values (
  '55555555-5555-4555-8555-555555555507',
  '55555555-5555-4555-8555-555555555506',
  1,
  'observe',
  'Observe the new version',
  array['Record the new evidence'],
  array['What changed?']
);

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at
)
values (
  '55555555-5555-4555-8555-555555555508',
  '55555555-5555-4555-8555-555555555503',
  '55555555-5555-4555-8555-555555555504',
  '55555555-5555-4555-8555-555555555501',
  'open',
  '2026-01-01T00:00:00Z'
);

-- A historical session is created before publication. Its case_id must stay
-- pinned to v1 even when the assignment remains on v1 after opt-out.
set local role service_role;
insert into public.sessions (
  id, case_id, student_id, class_case_assignment_id, current_phase_id
)
values (
  '55555555-5555-4555-8555-555555555509',
  '55555555-5555-4555-8555-555555555504',
  '55555555-5555-4555-8555-555555555502',
  '55555555-5555-4555-8555-555555555508',
  '55555555-5555-4555-8555-555555555505'
);
reset role;

-- The three-argument path explicitly opts out of assignment movement.
set local role service_role;
select id into temporary superseded_publish_result
  from public.publish_case(
    '55555555-5555-4555-8555-555555555506'::uuid,
    '2026-09-30T00:00:00Z'::timestamptz,
    false
  );
reset role;

select is(
  (select status::text from public.cases where id = '55555555-5555-4555-8555-555555555504'::uuid),
  'superseded',
  'the previous active version becomes superseded'
);
select is(
  (select status::text from public.cases where id = '55555555-5555-4555-8555-555555555506'::uuid),
  'active',
  'the linked draft becomes active'
);
select is(
  (select case_id from public.class_case_assignments where id = '55555555-5555-4555-8555-555555555508'::uuid),
  '55555555-5555-4555-8555-555555555504'::uuid,
  'opt-out publication leaves the existing assignment on the old version'
);
select lives_ok(
  $$update public.class_case_assignments
       set case_id = '55555555-5555-4555-8555-555555555504'::uuid
     where id = '55555555-5555-4555-8555-555555555508'::uuid$$,
  'an unchanged case_id update preserves historical assignment rows'
);
select is(
  (select case_id from public.sessions where id = '55555555-5555-4555-8555-555555555509'::uuid),
  '55555555-5555-4555-8555-555555555504'::uuid,
  'historical sessions retain their original case id'
);

select throws_ok(
  $$insert into public.sessions (
      id, case_id, student_id, class_case_assignment_id, current_phase_id
    ) values (
      '55555555-5555-4555-8555-555555555510'::uuid,
      '55555555-5555-4555-8555-555555555504'::uuid,
      '55555555-5555-4555-8555-555555555502'::uuid,
      null,
      '55555555-5555-4555-8555-555555555505'::uuid
    )$$,
  '55000',
  'Cannot start a session for a superseded case without an open assignment',
  'a direct superseded-case session start is rejected'
);

-- An open assignment is the explicit exception that permits a superseded
-- case to remain readable for students who were already assigned to it.
set local role service_role;
insert into public.sessions (
  id, case_id, student_id, class_case_assignment_id, current_phase_id
)
values (
  '55555555-5555-4555-8555-555555555511',
  '55555555-5555-4555-8555-555555555504',
  '55555555-5555-4555-8555-555555555502',
  '55555555-5555-4555-8555-555555555508',
  '55555555-5555-4555-8555-555555555505'
);
reset role;
select is(
  (select count(*)::integer from public.sessions where id = '55555555-5555-4555-8555-555555555511'::uuid),
  1,
  'an assigned student may start a superseded-case session'
);

select throws_ok(
  $$insert into public.class_case_assignments (
      id, class_id, case_id, assigned_by, status, opens_at
    ) values (
      '55555555-5555-4555-8555-555555555512'::uuid,
      '55555555-5555-4555-8555-555555555503'::uuid,
      '55555555-5555-4555-8555-555555555504'::uuid,
      '55555555-5555-4555-8555-555555555501'::uuid,
      'open',
      timezone('utc', now())
    )$$,
  '55000',
  'Assignments may target only active cases',
  'new assignments cannot target a superseded case'
);

-- A second linked version exercises the two-argument compatibility wrapper;
-- its default policy moves the open assignment from v2 to v3.
insert into public.cases (
  id, slug, title, specialty, status, patient_context, tags, created_by,
  source_case_id, version, published_at, difficulty
)
values (
  '55555555-5555-4555-8555-555555555513',
  'superseded-root-v3',
  'Superseded root v3',
  'dentistry',
  'draft',
  '{}'::jsonb,
  array['newer'],
  '55555555-5555-4555-8555-555555555501',
  '55555555-5555-4555-8555-555555555504',
  3,
  null,
  'advanced'
);

insert into public.case_phases (
  id, case_id, phase_order, phase_key, title, objectives, questions
)
values (
  '55555555-5555-4555-8555-555555555514',
  '55555555-5555-4555-8555-555555555513',
  1,
  'observe',
  'Observe the newest version',
  array['Record the newest evidence'],
  array['What changed again?']
);

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at
)
values (
  '55555555-5555-4555-8555-555555555515',
  '55555555-5555-4555-8555-555555555503',
  '55555555-5555-4555-8555-555555555506',
  '55555555-5555-4555-8555-555555555501',
  'open',
  '2026-01-01T00:00:00Z'
);

set local role service_role;
select id into temporary superseded_wrapper_result
  from public.publish_case(
    '55555555-5555-4555-8555-555555555513'::uuid,
    '2026-09-30T00:00:00Z'::timestamptz
  );
reset role;

select is(
  (select status::text from public.cases where id = '55555555-5555-4555-8555-555555555506'::uuid),
  'superseded',
  'the wrapper publication supersedes the previous linked version'
);
select is(
  (select status::text from public.cases where id = '55555555-5555-4555-8555-555555555513'::uuid),
  'active',
  'the wrapper publishes the newest linked draft'
);
select is(
  (select case_id from public.class_case_assignments where id = '55555555-5555-4555-8555-555555555515'::uuid),
  '55555555-5555-4555-8555-555555555513'::uuid,
  'the two-argument wrapper moves open assignments by default'
);

select throws_ok(
  $$update public.cases set title = 'Illegal superseded edit' where id = '55555555-5555-4555-8555-555555555506'::uuid$$,
  '55000',
  'Published case content is immutable; create a new draft version',
  'superseded case content cannot be edited'
);
select throws_ok(
  $$update public.cases
       set status = 'active', published_at = timezone('utc', now())
     where id = '55555555-5555-4555-8555-555555555506'::uuid$$,
  '55000',
  'Published case content is immutable; create a new draft version',
  'superseded status is terminal'
);
select throws_ok(
  $$update public.cases set title = 'Illegal active edit' where id = '55555555-5555-4555-8555-555555555513'::uuid$$,
  '55000',
  'Published case content is immutable; create a new draft version',
  'active case content remains immutable after superseding'
);
select throws_ok(
  $$delete from public.cases where id = '55555555-5555-4555-8555-555555555513'::uuid$$,
  '55000',
  'Published or archived cases are immutable and cannot be deleted',
  'published case rows cannot be deleted'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.publish_case(uuid,timestamptz,boolean)',
    'execute'
  ),
  'service role can execute the three-argument superseding publish RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.publish_case(uuid,timestamptz)',
    'execute'
  ),
  'service role can execute the two-argument compatibility wrapper'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.publish_case(uuid,timestamptz,boolean)',
    'execute'
  ),
  'anonymous callers cannot execute the three-argument superseding RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.publish_case(uuid,timestamptz)',
    'execute'
  ),
  'anonymous callers cannot execute the two-argument wrapper'
);

select * from finish();
rollback;
