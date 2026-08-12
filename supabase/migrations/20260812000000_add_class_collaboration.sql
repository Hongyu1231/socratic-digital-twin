-- Admin, professor, class, and assignment collaboration for the Socratic tutor.
--
-- The application continues to use a server-only service-role repository.
-- New public tables therefore enable RLS but deliberately define no browser
-- policies and grant no privileges to anon/authenticated.

begin;

alter table public.users
  add column is_active boolean not null default true;

alter table public.cases
  add column source_case_id uuid references public.cases (id) on delete restrict,
  add column version integer not null default 1,
  add column published_at timestamptz;

update public.cases
   set published_at = coalesce(published_at, created_at)
 where status in ('active'::public.case_status, 'archived'::public.case_status);

alter table public.cases
  add constraint cases_version_positive check (version > 0),
  add constraint cases_source_not_self check (source_case_id is null or source_case_id <> id),
  add constraint cases_publication_consistent check (
    (status = 'draft'::public.case_status and published_at is null)
    or
    (status in ('active'::public.case_status, 'archived'::public.case_status) and published_at is not null)
  );

-- Coalescing a root case to its own id gives every lineage a stable unique
-- (lineage, version) key while allowing source_case_id to remain null on roots.
create unique index cases_lineage_version_unique_idx
  on public.cases ((coalesce(source_case_id, id)), version);
create index cases_source_case_idx on public.cases (source_case_id);
create index users_active_role_idx on public.users (is_active, role);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  term text not null,
  status text not null default 'active',
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint classes_name_not_blank check (length(btrim(name)) > 0),
  constraint classes_code_not_blank check (length(btrim(code)) > 0),
  constraint classes_term_not_blank check (length(btrim(term)) > 0),
  constraint classes_status_valid check (status in ('active', 'archived')),
  constraint classes_timestamps_order check (updated_at >= created_at)
);

create table public.class_memberships (
  class_id uuid not null references public.classes (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete restrict,
  role public.user_role not null,
  is_lead boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (class_id, user_id),
  constraint class_memberships_role_valid check (role in ('student', 'professor')),
  constraint class_memberships_lead_is_professor check (not is_lead or role = 'professor'),
  constraint class_memberships_timestamps_order check (updated_at >= created_at)
);

create unique index class_memberships_one_lead_idx
  on public.class_memberships (class_id)
  where is_lead;
create index class_memberships_user_idx
  on public.class_memberships (user_id, class_id);
create index class_memberships_class_role_idx
  on public.class_memberships (class_id, role);

create table public.class_case_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  case_id uuid not null references public.cases (id) on delete restrict,
  assigned_by uuid not null references public.users (id) on delete restrict,
  status text not null default 'draft',
  opens_at timestamptz not null,
  due_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint class_case_assignments_status_valid check (status in ('draft', 'open', 'closed')),
  constraint class_case_assignments_window_valid check (due_at is null or due_at > opens_at),
  constraint class_case_assignments_timestamps_order check (updated_at >= created_at)
);

create index class_case_assignments_class_status_idx
  on public.class_case_assignments (class_id, status, opens_at);
create index class_case_assignments_case_idx
  on public.class_case_assignments (case_id);
create index class_case_assignments_assigned_by_idx
  on public.class_case_assignments (assigned_by);
create index class_case_assignments_open_window_idx
  on public.class_case_assignments (opens_at, due_at)
  where status = 'open';

alter table public.sessions
  add column class_case_assignment_id uuid
    references public.class_case_assignments (id) on delete restrict;

-- Establish the canonical demo class wherever the original fixture case is
-- present. Prefer its seeded professor; otherwise retain the case creator so
-- the migration also succeeds against independently seeded installations.
insert into public.classes (id, name, code, term, status, created_by)
select
  '55555555-5555-4555-8555-555555555555'::uuid,
  'Orthodontic Reasoning Demo',
  'DENT-DEMO',
  'AY2026/27',
  'active',
  coalesce(
    (select u.id
       from public.users as u
      where u.id = '22222222-2222-4222-8222-222222222222'::uuid),
    c.created_by
  )
from public.cases as c
where c.id = '33333333-3333-4333-8333-333333333333'::uuid
on conflict (id) do nothing;

-- Backfill existing participants into the demo class. Invalid legacy role
-- combinations remain visible through their sessions but cannot become class
-- memberships because admins are intentionally not class members.
insert into public.class_memberships (class_id, user_id, role, is_lead)
select
  '55555555-5555-4555-8555-555555555555'::uuid,
  u.id,
  u.role,
  u.id = '22222222-2222-4222-8222-222222222222'::uuid
    and u.role = 'professor'::public.user_role
from public.users as u
where u.role in ('student'::public.user_role, 'professor'::public.user_role)
  and exists (
    select 1
      from public.classes as c
     where c.id = '55555555-5555-4555-8555-555555555555'::uuid
  )
on conflict (class_id, user_id) do update
  set role = excluded.role,
      is_lead = excluded.is_lead,
      updated_at = timezone('utc', now());

insert into public.class_case_assignments (
  id,
  class_id,
  case_id,
  assigned_by,
  status,
  opens_at,
  due_at
)
select
  '66666666-6666-4666-8666-666666666666'::uuid,
  '55555555-5555-4555-8555-555555555555'::uuid,
  c.id,
  coalesce(
    (select u.id
       from public.users as u
      where u.id = '22222222-2222-4222-8222-222222222222'::uuid),
    c.created_by
  ),
  'open',
  '2026-08-09T00:00:00Z'::timestamptz,
  null
from public.cases as c
where c.id = '33333333-3333-4333-8333-333333333333'::uuid
  and exists (
    select 1
      from public.classes as cl
     where cl.id = '55555555-5555-4555-8555-555555555555'::uuid
  )
on conflict (id) do nothing;

-- Each student may have only one session for a given assignment. The newest
-- existing demo session becomes the canonical assignment session. Older demo
-- sessions and sessions for other cases receive closed historical assignments,
-- preserving every record without weakening the new uniqueness invariant.
create temporary table session_assignment_backfill (
  session_id uuid primary key,
  assignment_id uuid not null unique
) on commit drop;

insert into session_assignment_backfill (session_id, assignment_id)
select
  ranked.id,
  case
    when ranked.case_id = '33333333-3333-4333-8333-333333333333'::uuid
      and ranked.student_case_rank = 1
      and exists (
        select 1
          from public.class_case_assignments as a
         where a.id = '66666666-6666-4666-8666-666666666666'::uuid
      )
      then '66666666-6666-4666-8666-666666666666'::uuid
    else gen_random_uuid()
  end
from (
  select
    s.id,
    s.case_id,
    row_number() over (
      partition by s.student_id, s.case_id
      order by s.started_at desc, s.id desc
    ) as student_case_rank
  from public.sessions as s
) as ranked;

insert into public.class_case_assignments (
  id,
  class_id,
  case_id,
  assigned_by,
  status,
  opens_at,
  due_at,
  created_at,
  updated_at
)
select
  mapping.assignment_id,
  '55555555-5555-4555-8555-555555555555'::uuid,
  s.case_id,
  coalesce(
    (select u.id
       from public.users as u
      where u.id = '22222222-2222-4222-8222-222222222222'::uuid),
    c.created_by
  ),
  'closed',
  s.started_at,
  coalesce(s.ended_at, s.last_activity_at) + interval '1 microsecond',
  s.created_at,
  greatest(s.updated_at, s.created_at)
from session_assignment_backfill as mapping
join public.sessions as s on s.id = mapping.session_id
join public.cases as c on c.id = s.case_id
where mapping.assignment_id <> '66666666-6666-4666-8666-666666666666'::uuid
on conflict (id) do nothing;

update public.sessions as s
   set class_case_assignment_id = mapping.assignment_id
  from session_assignment_backfill as mapping
 where mapping.session_id = s.id;

alter table public.sessions
  alter column class_case_assignment_id set not null,
  add constraint sessions_assignment_student_unique
    unique (class_case_assignment_id, student_id);

create index sessions_assignment_idx
  on public.sessions (class_case_assignment_id);

-- One session has one review owner. The original composite unique constraints
-- remain valid for existing upsert calls; these stricter indexes reject a
-- competing professor before any second review can be established.
create unique index answer_reviews_message_unique_idx
  on public.answer_reviews (message_id);
create unique index session_reviews_session_unique_idx
  on public.session_reviews (session_id);

alter table public.classes enable row level security;
alter table public.class_memberships enable row level security;
alter table public.class_case_assignments enable row level security;

revoke all on table public.classes from public, anon, authenticated;
revoke all on table public.class_memberships from public, anon, authenticated;
revoke all on table public.class_case_assignments from public, anon, authenticated;

grant all on table public.classes to service_role;
grant all on table public.class_memberships to service_role;
grant all on table public.class_case_assignments to service_role;

commit;
