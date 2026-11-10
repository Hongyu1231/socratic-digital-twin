begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

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
  where a.class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822' and (c.status <> 'active' or c.is_test_fixture)),
  'QA class excludes archived and fixture cases');
select is((select count(*)::integer from public.sessions where student_id in (
  'f0c28ab2-a11e-4489-883f-8c20a4af2053', 'fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', '544fc03c-ee0b-487e-889a-f16830897444')), 0,
  'migration does not create learning sessions');
select ok(not exists (select 1 from public.class_case_assignments where class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822'
  and idempotency_key is distinct from 'isolated-demo-qa:' || case_id::text),
  'QA assignments have isolated, stable idempotency keys');

select * from finish();
rollback;
