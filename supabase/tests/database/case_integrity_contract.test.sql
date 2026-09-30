begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

select has_column('public', 'cases', 'difficulty', 'cases persist teaching difficulty');
select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'public.cases'::regclass
       and conname = 'cases_difficulty_valid'
  ),
  'difficulty has a database check constraint'
);
select ok(
  not exists (
    select 1
      from public.cases as c
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(c.attachments) = 'array' then c.attachments
          else '[]'::jsonb
        end
      ) as item(value)
     where jsonb_typeof(item.value) = 'object'
       and nullif(btrim(item.value ->> 'id'), '') is null
  ),
  'existing attachments all have permanent IDs after the one-time backfill'
);
select ok(
  not exists (
    select 1
      from public.cases
     where nullif(btrim(patient_context ->> 'teachingMaterialPackageId'), '') is not null
       and difficulty <> 'advanced'
  ),
  'source-backed teaching-material cases are advanced'
);
select ok(
  position('current_user' in lower(pg_get_functiondef('public.published_write_bypass_enabled()'::regprocedure))) > 0,
  'published-write bypass checks the executing role as well as the GUC'
);
select ok(
  position('order by c.id' in lower(pg_get_functiondef('public.guard_case_phase_publication_contract()'::regprocedure))) > 0
  and position('for update' in lower(pg_get_functiondef('public.guard_case_phase_publication_contract()'::regprocedure))) > 0,
  'phase writes lock both parent cases in deterministic order'
);
select ok(not has_function_privilege('anon', 'public.publish_case(uuid,timestamptz)', 'execute'), 'anon cannot publish cases');
select ok(has_function_privilege('service_role', 'public.publish_case(uuid,timestamptz)', 'execute'), 'service role can publish cases');
select ok(has_function_privilege('service_role', 'public.published_write_bypass_enabled()', 'execute'), 'service role can evaluate the seed bypass guard');
select ok(not has_function_privilege('anon', 'public.guard_case_publication_contract()', 'execute'), 'anon cannot call the case trigger function');
select ok(not has_function_privilege('anon', 'public.guard_case_phase_publication_contract()', 'execute'), 'anon cannot call the phase trigger function');

-- Exercise the role check directly.  The grant is test-scoped and rolled back
-- with this file; the deployed migration keeps the helper service-only.
grant execute on function public.published_write_bypass_enabled() to anon;
set local role anon;
set local app.allow_published_case_writes = 'true';
do $$
begin
  if public.published_write_bypass_enabled() then
    raise exception using message = 'untrusted role bypassed the publication guard';
  end if;
end;
$$;
reset role;
revoke execute on function public.published_write_bypass_enabled() from anon;
-- RESET ROLE does not reset transaction-local settings.  Disable the seed
-- bypass before exercising the normal draft/published guards below.
set local app.allow_published_case_writes = 'false';

insert into public.users (id, email, display_name, role)
values
  ('88888888-8888-4888-8888-888888888801', 'integrity-admin@test.invalid', 'Integrity Admin', 'admin'),
  ('88888888-8888-4888-8888-888888888802', 'integrity-student@test.invalid', 'Integrity Student', 'student');

insert into public.cases (
  id, slug, title, specialty, status, published_at, created_by, difficulty, attachments
)
values (
  '88888888-8888-4888-8888-888888888803',
  'integrity-draft',
  'Integrity Draft',
  'dentistry',
  'draft',
  null,
  '88888888-8888-4888-8888-888888888801',
  'advanced',
  '[{"id":"88888888-8888-4888-8888-888888888804","kind":"image","title":"Synthetic OPG","description":"Synthetic teaching image","url":"/media/integrity-opg.webp"}]'::jsonb
);

insert into public.case_phases (
  id, case_id, phase_order, phase_key, title, objectives, questions
)
values (
  '88888888-8888-4888-8888-888888888805',
  '88888888-8888-4888-8888-888888888803',
  1,
  'observe',
  'Observe',
  array['Record the supplied evidence'],
  array['What do you notice?']
);

select lives_ok(
  $$update public.cases set title = 'Edited Integrity Draft' where id = '88888888-8888-4888-8888-888888888803'::uuid$$,
  'draft case content remains editable'
);
select is(
  (select attachments -> 0 ->> 'id'
     from public.cases
    where id = '88888888-8888-4888-8888-888888888803'::uuid),
  '88888888-8888-4888-8888-888888888804',
  'existing attachment IDs remain stable across draft edits'
);

select lives_ok(
  $$select public.publish_case('88888888-8888-4888-8888-888888888803'::uuid, '2026-09-30T00:00:00Z'::timestamptz)$$,
  'draft can be published through the conditional publish operation'
);
select is(
  (select status::text from public.cases where id = '88888888-8888-4888-8888-888888888803'::uuid),
  'active',
  'published case is active'
);

select throws_ok(
  $$insert into public.cases (id, slug, title, specialty, status, published_at, created_by, difficulty)
    values ('88888888-8888-4888-8888-888888888809'::uuid, 'integrity-direct-active', 'Direct Active', 'dentistry', 'active', timezone('utc', now()), '88888888-8888-4888-8888-888888888801'::uuid, 'foundation')$$,
  '55000',
  'Cases must be created as draft before publication',
  'ordinary callers cannot insert a published case directly'
);

-- Exercise the real server role, not only its ACLs.  All of these writes run
-- with the normal (false) bypass setting and therefore cover the service-role
-- trigger helper grant as well as the draft -> publish -> archive path.
set local role service_role;
insert into public.cases (id, slug, title, specialty, status, published_at, created_by, difficulty)
values ('88888888-8888-4888-8888-888888888810'::uuid, 'integrity-service-case', 'Integrity Service Case', 'dentistry', 'draft', null, '88888888-8888-4888-8888-888888888801'::uuid, 'intermediate');
insert into public.case_phases (id, case_id, phase_order, phase_key, title, objectives, questions)
values ('88888888-8888-4888-8888-888888888811'::uuid, '88888888-8888-4888-8888-888888888810'::uuid, 1, 'observe', 'Observe', array['Record the supplied evidence'], array['What do you notice?']);
select id into temporary service_publish_result
  from public.publish_case('88888888-8888-4888-8888-888888888810'::uuid, timezone('utc', now()));
select id into temporary service_archive_result
  from public.archive_case('88888888-8888-4888-8888-888888888810'::uuid);
reset role;
select is(
  (select status::text from public.cases where id = '88888888-8888-4888-8888-888888888810'::uuid),
  'archived',
  'service-role archive leaves a terminal case'
);

select throws_ok(
  $$update public.cases set title = 'Illegal active edit' where id = '88888888-8888-4888-8888-888888888803'::uuid$$,
  '55000',
  'Published case content is immutable; create a new draft version',
  'active case content cannot be edited'
);

insert into public.cases (
  id, slug, title, specialty, status, published_at, created_by, difficulty
)
values (
  '88888888-8888-4888-8888-888888888808',
  'integrity-empty-phases',
  'Integrity Empty Phases',
  'dentistry',
  'draft',
  null,
  '88888888-8888-4888-8888-888888888801',
  'foundation'
);

select throws_ok(
  $$select public.publish_case('88888888-8888-4888-8888-888888888808'::uuid, timezone('utc', now()))$$,
  'P0001',
  'Case cannot be published without phases',
  'a case without phases cannot be published'
);
select throws_ok(
  $$update public.cases
       set status = 'active', published_at = timezone('utc', now())
     where id = '88888888-8888-4888-8888-888888888808'::uuid$$,
  '23514',
  'Case cannot be published without phases',
  'direct publication without phases is rejected by the trigger'
);

select throws_ok(
  $$insert into public.case_phases (case_id, phase_order, phase_key, title, objectives, questions)
    values ('88888888-8888-4888-8888-888888888803'::uuid, 2, 'second', 'Second', array['Observe'], array['What next?'])$$,
  '55000',
  'Published case phases are immutable',
  'phases cannot be inserted under an active case'
);
select throws_ok(
  $$update public.case_phases set title = 'Illegal phase edit' where id = '88888888-8888-4888-8888-888888888805'::uuid$$,
  '55000',
  'Published case phases are immutable',
  'active case phases cannot be edited'
);
select throws_ok(
  $$delete from public.case_phases where id = '88888888-8888-4888-8888-888888888805'::uuid$$,
  '55000',
  'Published case phases are immutable',
  'active case phases cannot be deleted'
);

insert into public.cases (
  id, slug, title, specialty, status, published_at, created_by, difficulty
)
values (
  '88888888-8888-4888-8888-888888888806',
  'integrity-second-draft',
  'Integrity Second Draft',
  'dentistry',
  'draft',
  null,
  '88888888-8888-4888-8888-888888888801',
  'foundation'
);
insert into public.case_phases (id, case_id, phase_order, phase_key, title, objectives, questions)
values (
  '88888888-8888-4888-8888-888888888807',
  '88888888-8888-4888-8888-888888888806',
  1,
  'observe',
  'Observe',
  array['Record the supplied evidence'],
  array['What do you notice?']
);

select throws_ok(
  $$update public.case_phases set case_id = '88888888-8888-4888-8888-888888888803'::uuid where id = '88888888-8888-4888-8888-888888888807'::uuid$$,
  '55000',
  'Published case phases are immutable',
  'a draft phase cannot be moved into an active case'
);

select lives_ok(
  $$select public.archive_case('88888888-8888-4888-8888-888888888803'::uuid)$$,
  'active case can be archived'
);
select is(
  (select status::text from public.cases where id = '88888888-8888-4888-8888-888888888803'::uuid),
  'archived',
  'archived case has terminal status'
);
select throws_ok(
  $$update public.cases set status = 'draft' where id = '88888888-8888-4888-8888-888888888803'::uuid$$,
  '55000',
  'Published case content is immutable; create a new draft version',
  'archived case cannot be reopened'
);
select throws_ok(
  $$select public.publish_case('88888888-8888-4888-8888-888888888803'::uuid, timezone('utc', now()))$$,
  'P0001',
  'Case cannot be published from status archived',
  'archived case cannot be republished'
);

select throws_ok(
  $$select public.publish_case('88888888-8888-4888-8888-888888888899'::uuid, timezone('utc', now()))$$,
  'P0002',
  'Case does not exist',
  'unknown case publish returns not found'
);

-- Seed compatibility is intentionally scoped to a privileged transaction.
set local app.allow_published_case_writes = 'true';
select lives_ok(
  $$update public.cases set title = 'Seed-compatible rewrite' where id = '88888888-8888-4888-8888-888888888803'::uuid$$,
  'privileged seed bypass can rewrite a published case'
);
select lives_ok(
  $$update public.case_phases set title = 'Seed-compatible phase rewrite' where id = '88888888-8888-4888-8888-888888888805'::uuid$$,
  'privileged seed bypass can rewrite a published phase'
);

select throws_ok(
  $$insert into public.cases (id, slug, title, specialty, status, created_by, difficulty)
    values ('88888888-8888-4888-8888-888888888899'::uuid, 'invalid-difficulty', 'Invalid difficulty', 'dentistry', 'draft', '88888888-8888-4888-8888-888888888801'::uuid, 'expert')$$,
  '23514',
  null,
  'difficulty outside the shared enum is rejected'
);

select * from finish();
rollback;
