-- A case can be archived before or after publication. Drafts still require a
-- null publication timestamp, and active cases still require a timestamp.
-- Archived cases preserve whichever publication state they had previously.

begin;

alter table public.cases
  drop constraint if exists cases_publication_consistent;

alter table public.cases
  add constraint cases_publication_consistent check (
    (status = 'draft'::public.case_status and published_at is null)
    or
    (status = 'active'::public.case_status and published_at is not null)
    or
    status = 'archived'::public.case_status
  );

comment on constraint cases_publication_consistent on public.cases is
  'Draft cases are unpublished, active cases are published, and archived cases may originate from either state.';

commit;
