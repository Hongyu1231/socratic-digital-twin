-- Persist validated teaching media with the case version it belongs to.
-- The application accepts HTTPS or site-relative URLs only and published case
-- versions remain immutable, so a media change requires a new case version.

alter table public.cases
  add column if not exists attachments jsonb not null default '[]'::jsonb;

update public.cases
   set attachments = patient_context -> 'attachments'
 where attachments = '[]'::jsonb
   and jsonb_typeof(patient_context -> 'attachments') = 'array';

alter table public.cases
  add constraint cases_attachments_array
  check (
    case
      when jsonb_typeof(attachments) = 'array' then jsonb_array_length(attachments) <= 12
      else false
    end
  );

comment on column public.cases.attachments is
  'Validated synthetic teaching media metadata. Never store patient data or binary content in this JSONB column.';
