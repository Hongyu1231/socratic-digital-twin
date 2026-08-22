begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(35);

select has_column('public', 'cases', 'attachments', 'cases stores teaching attachments');
select has_column('public', 'cases', 'is_test_fixture', 'cases marks disposable fixtures');
select has_column('public', 'class_case_assignments', 'idempotency_key', 'assignments accept stable idempotency keys');
select has_column('public', 'sessions', 'summary_generation_status', 'sessions expose summary generation state');
select has_table('public', 'session_summary_jobs', 'summary jobs table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.session_summary_jobs'::regclass),
  'summary jobs has RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.session_summary_jobs'::regclass),
  'summary jobs forces RLS'
);
select ok(not has_table_privilege('anon', 'public.session_summary_jobs', 'select'), 'anon cannot read summary jobs');
select ok(not has_table_privilege('authenticated', 'public.session_summary_jobs', 'select'), 'authenticated cannot read summary jobs');
select ok(has_table_privilege('service_role', 'public.session_summary_jobs', 'select'), 'service role can read summary jobs');
select ok(
  not has_function_privilege('anon', 'public.claim_session_summary_jobs(text,integer)', 'execute'),
  'anon cannot claim summary jobs'
);
select ok(
  has_function_privilege('service_role', 'public.claim_session_summary_jobs(text,integer)', 'execute'),
  'service role can claim summary jobs'
);
select ok(
  position('for share' in lower(pg_get_functiondef('public.reject_archived_case_session()'::regprocedure))) > 0,
  'archived-case guard takes a shared case lock before checking its status'
);

insert into public.users (id, email, display_name, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'admin@test.invalid', 'Test Admin', 'admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'student1@test.invalid', 'Test Student One', 'student'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'student2@test.invalid', 'Test Student Two', 'student'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'student3@test.invalid', 'Test Student Three', 'student');

insert into public.cases (
  id, slug, title, specialty, status, published_at, created_by, attachments
)
values
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'summary-job-case',
    'Summary Job Case',
    'dentistry',
    'active',
    timezone('utc', now()),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '[{"id":"11111111-1111-4111-8111-111111111111","kind":"image","title":"OPG","description":"Synthetic OPG","url":"/media/opg.jpg"}]'::jsonb
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'successful-summary-case',
    'Successful Summary Case',
    'dentistry',
    'active',
    timezone('utc', now()),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '[]'::jsonb
  );

insert into public.classes (id, name, code, term, created_by)
values (
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  'Integration Test Class',
  'TEST-CLASS',
  'AY2026/27',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
);

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at, idempotency_key
)
values
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'open',
    timezone('utc', now()) - interval '1 minute',
    'integration:summary:one'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'open',
    timezone('utc', now()) - interval '1 minute',
    'integration:summary:two'
  );

insert into public.class_case_assignments (
  class_id, case_id, assigned_by, status, opens_at, due_at, idempotency_key
)
values (
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'open',
  timezone('utc', now()) - interval '2 minutes',
  timezone('utc', now()) + interval '1 day',
  'integration:summary:one'
)
on conflict (idempotency_key) do update
  set due_at = excluded.due_at;

select is(
  (select count(*) from public.class_case_assignments where idempotency_key = 'integration:summary:one'),
  1::bigint,
  'idempotent assignment upsert keeps one row'
);
select ok(
  (select due_at > timezone('utc', now()) from public.class_case_assignments where idempotency_key = 'integration:summary:one'),
  'idempotent assignment upsert updates the existing row'
);

insert into public.sessions (
  id, case_id, student_id, class_case_assignment_id, context
)
values
  (
    'ffffffff-ffff-4fff-8fff-fffffffffff1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    '{"summary":{"overallScore":62,"headline":"Reliable summary","narrative":"Deterministic feedback","strengths":["Stayed engaged"],"weaknesses":[],"nextSteps":["Explain the evidence"],"completedAllPhases":false}}'::jsonb
  ),
  (
    'ffffffff-ffff-4fff-8fff-fffffffffff2',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    '{"summary":{"overallScore":75,"headline":"Reliable second summary","narrative":"Deterministic feedback","strengths":["Used evidence"],"weaknesses":[],"nextSteps":["State the uncertainty"],"completedAllPhases":true}}'::jsonb
  );

update public.sessions
set status = 'completed', ended_at = timezone('utc', now())
where id in (
  'ffffffff-ffff-4fff-8fff-fffffffffff1',
  'ffffffff-ffff-4fff-8fff-fffffffffff2'
);

select is((select count(*) from public.session_summary_jobs), 2::bigint, 'completion enqueues one job per session');
select is(
  (select count(*) from public.sessions where summary_generation_status = 'pending'),
  2::bigint,
  'completed sessions are immediately marked pending for optional enhancement'
);

create temporary table initial_claims on commit drop as
select * from public.claim_session_summary_jobs('integration-worker-a', 20);

select is((select count(*) from initial_claims), 2::bigint, 'one worker claims all available jobs exactly once');
select is(
  (select count(*) from public.claim_session_summary_jobs('integration-worker-b', 20)),
  0::bigint,
  'a competing worker cannot claim processing jobs'
);

select throws_ok(
  (
    select format(
      'select public.apply_session_summary_job(%L::uuid,%L::uuid,%L::jsonb,%L,%L)',
      id,
      claim_token,
      '{"overallScore":90,"headline":"Invalid","narrative":"Missing strengths","strengths":[],"weaknesses":[],"nextSteps":["Continue"],"completedAllPhases":true}',
      'test-provider',
      'test-model'
    )
    from initial_claims
    where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2'
  ),
  '22023',
  'Summary must contain at least one strength',
  'empty strengths cannot replace the deterministic summary'
);

do $$
declare
  claimed initial_claims%rowtype;
begin
  select * into claimed
  from initial_claims
  where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2';

  perform public.apply_session_summary_job(
    claimed.id,
    claimed.claim_token,
    '{"overallScore":75,"headline":"Enhanced summary","narrative":"Improved wording","strengths":["Used evidence"],"weaknesses":[],"nextSteps":["State the uncertainty"],"completedAllPhases":true}'::jsonb,
    'test-provider',
    'test-model'
  );
end;
$$;

select is(
  (select status::text from public.session_summary_jobs where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2'),
  'completed',
  'a valid enhanced summary completes its job'
);
select is(
  (select summary_generation_status from public.sessions where id = 'ffffffff-ffff-4fff-8fff-fffffffffff2'),
  'ready',
  'a successfully enhanced session becomes ready'
);
select is(
  (select context -> 'summary' ->> 'headline' from public.sessions where id = 'ffffffff-ffff-4fff-8fff-fffffffffff2'),
  'Enhanced summary',
  'the enhanced summary atomically replaces the deterministic wording'
);

do $$
declare
  claimed initial_claims%rowtype;
begin
  select * into claimed
  from initial_claims
  where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
  perform public.apply_session_summary_job(
    claimed.id,
    claimed.claim_token,
    '{"overallScore":75,"headline":"Ignored duplicate","narrative":"Retry","strengths":["Used evidence"],"weaknesses":[],"nextSteps":["State the uncertainty"],"completedAllPhases":true}'::jsonb,
    'test-provider',
    'test-model'
  );
end;
$$;

select is(
  (select context -> 'summary' ->> 'headline' from public.sessions where id = 'ffffffff-ffff-4fff-8fff-fffffffffff2'),
  'Enhanced summary',
  'reapplying a completed claim is an idempotent no-op'
);

do $$
declare
  claimed initial_claims%rowtype;
begin
  select * into claimed
  from initial_claims
  where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  perform public.fail_session_summary_job(claimed.id, claimed.claim_token, 'provider timeout one');
end;
$$;

select is(
  (select status::text from public.session_summary_jobs where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'pending',
  'the first provider failure schedules a retry'
);
select ok(
  (select available_at >= timezone('utc', now()) + interval '25 seconds' from public.session_summary_jobs where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'the first retry backs off by approximately 30 seconds'
);

update public.session_summary_jobs
set available_at = timezone('utc', now()) - interval '1 second'
where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
create temporary table second_claim on commit drop as
select * from public.claim_session_summary_jobs('integration-worker-second', 1);
do $$
declare claimed second_claim%rowtype;
begin
  select * into claimed from second_claim;
  perform public.fail_session_summary_job(claimed.id, claimed.claim_token, 'provider timeout two');
end;
$$;

select is(
  (select status::text from public.session_summary_jobs where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'pending',
  'the second provider failure schedules the final retry'
);
select ok(
  (select available_at >= timezone('utc', now()) + interval '55 seconds' from public.session_summary_jobs where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'the second retry backs off exponentially to approximately 60 seconds'
);

update public.session_summary_jobs
set available_at = timezone('utc', now()) - interval '1 second'
where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
create temporary table third_claim on commit drop as
select * from public.claim_session_summary_jobs('integration-worker-third', 1);
do $$
declare claimed third_claim%rowtype;
begin
  select * into claimed from third_claim;
  perform public.fail_session_summary_job(claimed.id, claimed.claim_token, 'provider timeout three');
end;
$$;

select is(
  (select status::text from public.session_summary_jobs where session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'failed',
  'the third provider failure is terminal'
);
select is(
  (select summary_generation_status from public.sessions where id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'failed',
  'the session exposes terminal enhancement failure'
);
select is(
  (select context -> 'summary' ->> 'headline' from public.sessions where id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'),
  'Reliable summary',
  'terminal enhancement failure preserves the deterministic summary'
);

select lives_ok(
  $$select public.archive_case('cccccccc-cccc-4ccc-8ccc-ccccccccccc1'::uuid)$$,
  'archiving a case succeeds'
);
select is(
  (select status from public.class_case_assignments where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'),
  'closed',
  'archiving a case closes its open assignment in the same transaction'
);
select is(
  (select count(*) from public.sessions where case_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  1::bigint,
  'archiving preserves historical sessions'
);

insert into public.class_case_assignments (
  id, class_id, case_id, assigned_by, status, opens_at
)
values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'open',
  timezone('utc', now()) - interval '1 minute'
);

select throws_ok(
  $$
    insert into public.sessions (
      case_id, student_id, class_case_assignment_id, context
    ) values (
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
      '{}'::jsonb
    )
  $$,
  '55000',
  'Cannot start a session for an archived case',
  'the database rejects a new session for an archived case'
);

select * from finish();
rollback;
