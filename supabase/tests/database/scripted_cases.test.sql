begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select is(
  (select count(*) from public.cases where id = '33333333-3333-4333-8333-333333333337'::uuid),
  1::bigint,
  'the impacted second-molar teaching case exists'
);

select is(
  (select count(*) from public.case_phases where case_id = '33333333-3333-4333-8333-333333333337'::uuid),
  6::bigint,
  'the impacted second-molar case has all six scripted phases'
);

select is(
  (
    select count(*)
    from public.case_phases
    where case_id = '33333333-3333-4333-8333-333333333337'::uuid
      and jsonb_array_length(coalesce(metadata -> 'tutorMoves', '[]'::jsonb)) > 0
  ),
  6::bigint,
  'every second-molar phase has at least one scripted tutor move'
);

select is(
  (
    select status::text
    from public.class_case_assignments
    where id = '66666666-6666-4666-8666-666666666670'::uuid
  ),
  'open',
  'the demo assignment for the second-molar case is open'
);

select ok(
  (
    select patient_context ->> 'simulation' = 'true'
    from public.cases
    where id = '33333333-3333-4333-8333-333333333337'::uuid
  ),
  'the second-molar case is explicitly marked as synthetic simulation data'
);

select * from finish();
rollback;
