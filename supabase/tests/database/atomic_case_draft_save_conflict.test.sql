begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(2);

insert into public.users (id, email, display_name, role)
values ('66666666-6666-4666-8666-666666666601', 'atomic-conflict-admin@test.invalid', 'Atomic Conflict Admin', 'admin');

insert into public.cases (
  id, slug, title, specialty, status, published_at, created_by, difficulty
)
values (
  '66666666-6666-4666-8666-666666666602',
  'atomic-conflict-case',
  'Atomic Conflict Case',
  'dentistry',
  'draft',
  null,
  '66666666-6666-4666-8666-666666666601',
  'intermediate'
);

insert into public.case_phases (
  id, case_id, phase_order, phase_key, title, objectives, questions
)
values (
  '66666666-6666-4666-8666-666666666603',
  '66666666-6666-4666-8666-666666666602',
  1,
  'phase_1',
  'Observe',
  array['Record the supplied evidence'],
  array['What do you notice?']
);

set local role service_role;
select id into temporary conflict_publish_result
  from public.publish_case('66666666-6666-4666-8666-666666666602'::uuid, timezone('utc', now()));
do $$
begin
  begin
    perform public.save_case_draft(
      '66666666-6666-4666-8666-666666666602'::uuid,
      'Published edit',
      'atomic-conflict-case',
      'dentistry',
      'Published edit',
      '66666666-6666-4666-8666-666666666601'::uuid,
      null,
      2,
      '{}'::jsonb,
      '[]'::jsonb,
      array['Published objective'],
      'advanced',
      '[{"id":"66666666-6666-4666-8666-666666666604","phase_order":1,"phase_key":"phase_1","title":"Published edit","objectives":["Published"],"questions":["What is published?"]}]'::jsonb
    );
    raise exception using
      errcode = 'P0001',
      message = 'save_case_draft unexpectedly accepted a published case';
  exception
    when sqlstate '55000' then
      null;
  end;
end;
$$;
reset role;

select is(
  (select status::text from public.cases where id = '66666666-6666-4666-8666-666666666602'::uuid),
  'active',
  'a rejected draft save leaves the published status intact'
);
select is(
  (select title from public.cases where id = '66666666-6666-4666-8666-666666666602'::uuid),
  'Atomic Conflict Case',
  'a rejected draft save leaves published content intact'
);

select * from finish();
rollback;
