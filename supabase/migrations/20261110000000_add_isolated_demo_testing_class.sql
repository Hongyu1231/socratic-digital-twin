-- Three synthetic demo identities in an isolated QA class. They are separate
-- from resident codes and never modify an existing student's session.
-- This migration copies only currently open, active, non-fixture assignments
-- from the seeded demo class. Later case publishing can move open assignments
-- by lineage using the existing publication workflow.
begin;

do $$
begin
  if not exists (select 1 from public.users where id = '99999999-9999-4999-8999-999999999999' and role = 'admin' and is_active)
     or not exists (select 1 from public.users where id = '22222222-2222-4222-8222-222222222222' and role = 'professor' and is_active)
     or not exists (select 1 from public.classes where id = '55555555-5555-4555-8555-555555555555' and status = 'active') then
    raise notice 'Seeded demo identities or class absent; no QA identities created.';
    return;
  end if;

  if exists (
    select 1 from (values
      ('f0c28ab2-a11e-4489-883f-8c20a4af2053'::uuid, 'test-student-01@example.invalid', 'Test Student 01'),
      ('fb8f5fa4-9e1c-46ca-92f2-9db694fadf67'::uuid, 'test-student-02@example.invalid', 'Test Student 02'),
      ('544fc03c-ee0b-487e-889a-f16830897444'::uuid, 'test-student-03@example.invalid', 'Test Student 03')
    ) as expected(id, email, display_name)
    join public.users u on u.id = expected.id or lower(u.email) = lower(expected.email)
    where u.id <> expected.id or lower(u.email) <> lower(expected.email)
       or u.display_name <> expected.display_name or u.role <> 'student' or not u.is_active
       or u.auth_user_id is not null or u.profile ->> 'testingOnly' is distinct from 'true'
       or u.profile ->> 'synthetic' is distinct from 'true'
  ) then
    raise exception 'QA identity collision: existing users were not modified';
  end if;
  if exists (select 1 from public.classes c
      where (c.id = '5a24a593-5bec-434c-80ff-2ffb88d72822' or c.code = 'TUTOR-QA-ONLY')
        and (c.id <> '5a24a593-5bec-434c-80ff-2ffb88d72822' or c.code <> 'TUTOR-QA-ONLY'
          or c.name <> 'Tutor QA (test only)' or c.term <> 'Testing only' or c.status <> 'active'
          or c.created_by <> '99999999-9999-4999-8999-999999999999')) then
    raise exception 'QA class collision: existing class was not modified';
  end if;

  insert into public.users (id, email, display_name, role, is_active, profile)
  values
    ('f0c28ab2-a11e-4489-883f-8c20a4af2053', 'test-student-01@example.invalid', 'Test Student 01', 'student', true, '{"testingOnly":true,"synthetic":true}'::jsonb),
    ('fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', 'test-student-02@example.invalid', 'Test Student 02', 'student', true, '{"testingOnly":true,"synthetic":true}'::jsonb),
    ('544fc03c-ee0b-487e-889a-f16830897444', 'test-student-03@example.invalid', 'Test Student 03', 'student', true, '{"testingOnly":true,"synthetic":true}'::jsonb)
  on conflict (id) do nothing;

  insert into public.classes (id, name, code, term, status, created_by)
  values ('5a24a593-5bec-434c-80ff-2ffb88d72822', 'Tutor QA (test only)', 'TUTOR-QA-ONLY',
          'Testing only', 'active', '99999999-9999-4999-8999-999999999999')
  on conflict (id) do nothing;

  if exists (select 1 from public.class_memberships where class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822'
      and ((user_id in ('f0c28ab2-a11e-4489-883f-8c20a4af2053', 'fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', '544fc03c-ee0b-487e-889a-f16830897444') and (role <> 'student' or is_lead))
        or (user_id = '22222222-2222-4222-8222-222222222222' and (role <> 'professor' or not is_lead))
        or (is_lead and user_id <> '22222222-2222-4222-8222-222222222222')
        or user_id not in ('22222222-2222-4222-8222-222222222222', 'f0c28ab2-a11e-4489-883f-8c20a4af2053', 'fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', '544fc03c-ee0b-487e-889a-f16830897444'))) then
    raise exception 'QA membership collision: existing memberships were not modified';
  end if;
  if exists (select 1 from public.class_case_assignments where class_id = '5a24a593-5bec-434c-80ff-2ffb88d72822'
      and (idempotency_key is distinct from 'isolated-demo-qa:' || case_id::text
        or status <> 'open' or opens_at > now() or (due_at is not null and due_at <= now()))) then
    raise exception 'QA assignment collision: existing assignments were not modified';
  end if;
  if exists (
    select 1 from public.class_case_assignments a
    join public.cases c on c.id = a.case_id
    join public.class_case_assignments existing on existing.idempotency_key = 'isolated-demo-qa:' || a.case_id::text
    where a.class_id = '55555555-5555-4555-8555-555555555555' and a.status = 'open'
      and a.opens_at <= now() and (a.due_at is null or a.due_at > now())
      and c.status = 'active'::public.case_status and not c.is_test_fixture
      and (existing.class_id <> '5a24a593-5bec-434c-80ff-2ffb88d72822' or existing.case_id <> a.case_id)
  ) then
    raise exception 'QA assignment key collision: existing assignments were not modified';
  end if;
  insert into public.class_memberships (class_id, user_id, role, is_lead)
  values
    ('5a24a593-5bec-434c-80ff-2ffb88d72822', '22222222-2222-4222-8222-222222222222', 'professor', true),
    ('5a24a593-5bec-434c-80ff-2ffb88d72822', 'f0c28ab2-a11e-4489-883f-8c20a4af2053', 'student', false),
    ('5a24a593-5bec-434c-80ff-2ffb88d72822', 'fb8f5fa4-9e1c-46ca-92f2-9db694fadf67', 'student', false),
    ('5a24a593-5bec-434c-80ff-2ffb88d72822', '544fc03c-ee0b-487e-889a-f16830897444', 'student', false)
  on conflict (class_id, user_id) do nothing;

  insert into public.class_case_assignments (class_id, case_id, assigned_by, status, opens_at, due_at, idempotency_key)
  select distinct '5a24a593-5bec-434c-80ff-2ffb88d72822'::uuid, a.case_id,
         '22222222-2222-4222-8222-222222222222'::uuid, 'open', '2026-01-01T00:00:00Z'::timestamptz,
         null::timestamptz, 'isolated-demo-qa:' || a.case_id::text
    from public.class_case_assignments a
    join public.cases c on c.id = a.case_id
   where a.class_id = '55555555-5555-4555-8555-555555555555'
     and a.status = 'open' and a.opens_at <= now() and (a.due_at is null or a.due_at > now())
     and c.status = 'active'::public.case_status and not c.is_test_fixture
  on conflict (idempotency_key) do nothing;
end;
$$;

commit;
