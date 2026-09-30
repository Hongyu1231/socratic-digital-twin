begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

select has_function(
  'public',
  'save_case_draft',
  array[
    'uuid', 'text', 'text', 'text', 'text', 'uuid', 'uuid', 'integer',
    'jsonb', 'jsonb', 'text[]', 'text', 'jsonb'
  ],
  'atomic draft-save RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.save_case_draft(uuid,text,text,text,text,uuid,uuid,integer,jsonb,jsonb,text[],text,jsonb)',
    'execute'
  ),
  'service role can save draft cases'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.save_case_draft(uuid,text,text,text,text,uuid,uuid,integer,jsonb,jsonb,text[],text,jsonb)',
    'execute'
  ),
  'anonymous callers cannot save draft cases'
);

insert into public.users (id, email, display_name, role)
values (
  '77777777-7777-4777-8777-777777777701',
  'draft-save-admin@test.invalid',
  'Draft Save Admin',
  'admin'
);

-- Call the RPC as the actual server role.  SELECT INTO keeps the composite
-- result out of the TAP stream while still exercising the returned row.
set local role service_role;
select id into temporary saved_draft_result
  from public.save_case_draft(
    '77777777-7777-4777-8777-777777777702'::uuid,
    'Atomic Draft Case',
    'atomic-draft-case',
    'dentistry',
    'A synthetic draft used for database contract tests.',
    '77777777-7777-4777-8777-777777777701'::uuid,
    null,
    1,
    '{"source":"database-test"}'::jsonb,
    '[]'::jsonb,
    array['synthetic evidence'],
    'intermediate',
    $json$[
      {
        "id":"77777777-7777-4777-8777-777777777703",
        "phase_order":1,
        "phase_key":"observe",
        "title":"Observe",
        "objectives":["Record the supplied evidence"],
        "questions":["What do you notice?"],
        "teaching_notes":null,
        "expected_findings":{},
        "metadata":{}
      }
    ]$json$::jsonb
  );
reset role;

select is(
  (select id from saved_draft_result),
  '77777777-7777-4777-8777-777777777702'::uuid,
  'service-role draft save returns the requested case'
);
select is(
  (select status::text from public.cases where id = '77777777-7777-4777-8777-777777777702'::uuid),
  'draft',
  'draft save keeps the case unpublished'
);
select is(
  (select difficulty from public.cases where id = '77777777-7777-4777-8777-777777777702'::uuid),
  'intermediate',
  'draft save persists difficulty'
);
select is(
  (select count(*) from public.case_phases where case_id = '77777777-7777-4777-8777-777777777702'::uuid),
  1::bigint,
  'draft save creates the supplied phases'
);
select is(
  (select id from public.case_phases where case_id = '77777777-7777-4777-8777-777777777702'::uuid),
  '77777777-7777-4777-8777-777777777703'::uuid,
  'draft save preserves supplied phase IDs'
);

-- A phase constraint failure must roll back the header update and phase
-- replacement made earlier in the same RPC invocation.
set local role service_role;
do $$
begin
  begin
    perform public.save_case_draft(
      '77777777-7777-4777-8777-777777777702'::uuid,
      'This header must roll back',
      'atomic-draft-case',
      'dentistry',
      'This invalid replacement must not persist.',
      '77777777-7777-4777-8777-777777777701'::uuid,
      null,
      1,
      '{"source":"database-test"}'::jsonb,
      '[]'::jsonb,
      array['synthetic evidence'],
      'intermediate',
      $json$[
        {
          "id":"77777777-7777-4777-8777-777777777704",
          "phase_order":0,
          "phase_key":"invalid",
          "title":"Invalid",
          "objectives":["This violates phase_order > 0"],
          "questions":["Should fail"]
        }
      ]$json$::jsonb
    );
    raise exception using
      errcode = 'P0001',
      message = 'save_case_draft unexpectedly accepted an invalid phase';
  exception
    when sqlstate '23514' then
      null;
  end;
end;
$$;
reset role;

select is(
  (select title from public.cases where id = '77777777-7777-4777-8777-777777777702'::uuid),
  'Atomic Draft Case',
  'failed phase replacement rolls back the case header'
);
select is(
  (select id from public.case_phases where case_id = '77777777-7777-4777-8777-777777777702'::uuid),
  '77777777-7777-4777-8777-777777777703'::uuid,
  'failed phase replacement preserves the previous phase'
);

select * from finish();
rollback;
