begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select is((select count(*)::integer from public.users where id in (
  'f0c28ab2-a11e-4489-883f-8c20a4af2053', 'fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', '544fc03c-ee0b-487e-889a-f16830897444'
) and role = 'student' and is_active and auth_user_id is null and profile ->> 'testingOnly' = 'true' and profile ->> 'synthetic' = 'true'), 3,
  'three synthetic, active, testing-only identities exist without auth links');
select is((select count(*)::integer from public.class_memberships where class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822' and role = 'student'), 3,
  'QA class contains three students');
select is((select count(*)::integer from public.class_memberships where class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822' and role = 'professor' and is_lead), 1,
  'QA class has one lead professor');
select is((select count(*)::integer from public.class_memberships where class_id <> '5a24a593-5bec-434c-80ff-2ffb88d72822' and user_id in (
  'f0c28ab2-a11e-4489-883f-8c20a4af2053', 'fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', '544fc03c-ee0b-487e-889a-f16830897444')), 0,
  'QA students are not assigned to existing classes');
select ok(not exists (select 1 from public.class_case_assignments a join public.cases c on c.id = a.case_id
  where a.class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822' and a.status = 'open'
    and (c.status <> 'active' or c.is_test_fixture)),
  'QA class has no open assignments for archived or fixture cases');
select is((select count(*)::integer from public.sessions where student_id in (
  'f0c28ab2-a11e-4489-883f-8c20a4af2053', 'fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', '544fc03c-ee0b-487e-889a-f16830897444')), 0,
  'migration does not create learning sessions');
select ok(not exists (select 1 from public.class_case_assignments where class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822'
  and idempotency_key is distinct from 'isolated-demo-qa:' || case_id::text),
  'QA assignments have isolated, stable idempotency keys');

-- The migration runs before seed.sql. A case copied while active can later be
-- archived by the seed or an administrator; its closed assignment must remain
-- as historical data, while no longer being open to QA students.
create temporary table qa_archive_target on commit drop as
  select a.id as assignment_id, a.case_id
  from public.class_case_assignments a
  join public.cases c on c.id = a.case_id
  where a.class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822'
    and a.status = 'open' and c.status = 'active' and not c.is_test_fixture
  order by a.id limit 1;
select is((select count(*)::integer from qa_archive_target), 1,
  'an open QA assignment is available for the archive regression');
do $$ begin
  if exists (select 1 from qa_archive_target) then
    perform public.archive_case((select case_id from qa_archive_target));
  end if;
end $$;
select is((select count(*)::integer from public.class_case_assignments a
  join qa_archive_target t on t.assignment_id = a.id
  where a.status = 'closed'), 1,
  'archiving closes the QA assignment and preserves its history');

select * from finish();
rollback;
