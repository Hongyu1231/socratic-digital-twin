-- Case data-integrity contract (schema/backfill stage).
--
-- This migration intentionally runs before the publication immutability
-- triggers in 20260930115421_case_publication_immutability.sql.  It adds the
-- columns and normalises legacy attachment rows first; the following
-- migration can then safely enforce the contract for new writes.

begin;

alter table public.cases
  add column if not exists difficulty text;

-- The teaching-material importer records its immutable source package in the
-- case context.  That provenance is the only reliable way to identify the
-- three imported Cases 1–3 during a migration; row order and title guesses
-- are deliberately not used.  The importer authors these cases as advanced.
update public.cases
   set difficulty = 'advanced'
 where nullif(btrim(patient_context ->> 'teachingMaterialPackageId'), '') is not null;

update public.cases
   set difficulty = 'intermediate'
 where difficulty is null;

alter table public.cases
  alter column difficulty set default 'intermediate',
  alter column difficulty set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.cases'::regclass
       and conname = 'cases_difficulty_valid'
  ) then
    alter table public.cases
      add constraint cases_difficulty_valid
      check (difficulty in ('foundation', 'intermediate', 'advanced'));
  end if;
end;
$$;

comment on column public.cases.difficulty is
  'Author-selected teaching difficulty. Source-backed imported Cases 1–3 are advanced.';

-- Assign permanent IDs only where an attachment does not already have one.
-- jsonb_agg(... order by ordinality) preserves attachment order and the
-- one-time WHERE clause means a later read never invents a replacement ID.
update public.cases as c
   set attachments = repaired.attachments
  from (
    select
      c2.id,
      jsonb_agg(
        case
          when jsonb_typeof(item.value) = 'object'
            and nullif(btrim(item.value ->> 'id'), '') is null
            then item.value || jsonb_build_object('id', gen_random_uuid()::text)
          else item.value
        end
        order by item.ordinality
      ) as attachments
      from public.cases as c2
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(c2.attachments) = 'array' then c2.attachments
          else '[]'::jsonb
        end
      ) with ordinality as item(value, ordinality)
     where jsonb_typeof(c2.attachments) = 'array'
       and exists (
         select 1
           from jsonb_array_elements(
             case
               when jsonb_typeof(c2.attachments) = 'array' then c2.attachments
               else '[]'::jsonb
             end
           ) as missing(value)
          where jsonb_typeof(missing.value) = 'object'
            and nullif(btrim(missing.value ->> 'id'), '') is null
       )
     group by c2.id
  ) as repaired
 where c.id = repaired.id;

comment on column public.cases.attachments is
  'Validated teaching media metadata. Existing attachment IDs are preserved; missing IDs are assigned once by this migration. Full authoring diagnostics remain in the shared application schema.';

commit;
