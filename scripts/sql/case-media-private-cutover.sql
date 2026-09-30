-- Forward metadata cutover for existing published teaching media.
--
-- Run only after the deployed runtime understands storagePath and after
-- scripts/prepare-private-media-migration.mjs --apply has copied and verified
-- every referenced object into teaching-case-media-private. This candidate is
-- intentionally staged outside supabase/migrations until that rollout gate is
-- complete.
--
-- Scope is deliberately limited to cases.attachments and the legacy
-- patient_context.attachments mirror. It does not edit phases, clinical text,
-- versions, assignments, sessions, or Storage objects.

begin;

-- Published rows are normally immutable. Use the existing role-gated helper;
-- setting the GUC alone is not sufficient because the helper also checks the
-- database role (postgres/service_role/supabase_admin).
set local app.allow_published_case_writes = 'true';

do $$
begin
  if not public.published_write_bypass_enabled() then
    raise exception using
      errcode = '42501',
      message = 'Private media cutover requires the existing privileged publication bypass';
  end if;
end;
$$;

-- Keep the attachment snapshot and metadata update in one short critical
-- section. SHARE ROW EXCLUSIVE blocks concurrent INSERT/UPDATE/DELETE on
-- cases while still allowing ordinary reads, so a writer cannot change an
-- attachment between reference collection and the cutover below.
lock table public.cases in share row exclusive mode;

-- Only publisher-generated URLs from the tutor's existing public bucket are
-- eligible. The package hash + attachment UUID shape is the safe key shape
-- emitted by the importer; citations and unrelated URLs are not candidates.
create or replace function pg_temp.private_media_key(value text)
returns text
language sql
immutable
strict
as $function$
  select substring(
    $1 from
    '^https://zulvdacbqvmqmtotyeuc[.]supabase[.]co/storage/v1/object/public/teaching-case-media/([0-9A-Fa-f]{64}/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}[.]webp)$'
  );
$function$;

create or replace function pg_temp.cutover_attachment_array(input jsonb)
returns jsonb
language plpgsql
immutable
as $function$
declare
  item jsonb;
  result jsonb := '[]'::jsonb;
  url_key text;
  source_key text;
  storage_key text;
  transformed jsonb;
begin
  if input is null or jsonb_typeof(input) <> 'array' then
    return input;
  end if;

  for item in select value from jsonb_array_elements(input) loop
    url_key := pg_temp.private_media_key(item ->> 'url');
    source_key := pg_temp.private_media_key(item ->> 'sourceUrl');

    if url_key is null and source_key is null then
      result := result || jsonb_build_array(item);
      continue;
    end if;

    if url_key is not null and source_key is not null and url_key <> source_key then
      raise exception using
        errcode = '22023',
        message = 'An attachment references two different public teaching-media objects';
    end if;

    -- A private attachment cannot retain a separate public URL. Requiring a
    -- manual review here avoids silently discarding an unexpected media URL.
    if url_key is null and item ? 'url' and nullif(btrim(item ->> 'url'), '') is not null then
      raise exception using
        errcode = '22023',
        message = 'An attachment has a public media URL alongside an old public source URL';
    end if;

    storage_key := coalesce(url_key, source_key);
    if item ? 'storagePath'
       and nullif(btrim(item ->> 'storagePath'), '') is distinct from storage_key then
      raise exception using
        errcode = '22023',
        message = 'An attachment already has a different private storage path';
    end if;

    -- Remove only the old Storage references. A genuine source citation in
    -- sourceUrl is retained; IDs and every other teaching/provenance field are
    -- preserved byte-for-byte by the JSONB merge.
    transformed := (item - 'url' - 'sourceUrl') || jsonb_build_object('storagePath', storage_key);
    if item ? 'sourceUrl' and source_key is null then
      transformed := transformed || jsonb_build_object('sourceUrl', item ->> 'sourceUrl');
    end if;
    result := result || jsonb_build_array(transformed);
  end loop;

  return result;
end;
$function$;

create temporary table pg_temp.private_media_cutover_refs (
  storage_path text primary key
) on commit drop;

insert into pg_temp.private_media_cutover_refs (storage_path)
select distinct candidate.storage_path
  from (
    select pg_temp.private_media_key(item.value ->> 'url') as storage_path
      from public.cases as c
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end
      ) as item
    union all
    select pg_temp.private_media_key(item.value ->> 'sourceUrl') as storage_path
      from public.cases as c
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end
      ) as item
    union all
    select pg_temp.private_media_key(item.value ->> 'url') as storage_path
      from public.cases as c
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(c.patient_context -> 'attachments') = 'array'
             then c.patient_context -> 'attachments'
             else '[]'::jsonb
        end
      ) as item
    union all
    select pg_temp.private_media_key(item.value ->> 'sourceUrl') as storage_path
      from public.cases as c
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(c.patient_context -> 'attachments') = 'array'
             then c.patient_context -> 'attachments'
             else '[]'::jsonb
        end
      ) as item
  ) as candidate
 where candidate.storage_path is not null
on conflict do nothing;

-- Metadata must not be cut over until every referenced private object exists.
-- The preparation script verifies source bytes and target bytes; this second
-- check keeps the SQL safe if the database is changed or restored separately.
do $$
begin
  -- A fresh isolated database may have no private bucket (or even the
  -- optional storage schema) yet. A no-reference run is a safe no-op and must
  -- not require either relation. Once eligible references exist, fail closed
  -- unless the private bucket is present and explicitly non-public.
  if exists (select 1 from pg_temp.private_media_cutover_refs) then
    if not exists (
      select 1
        from storage.buckets as bucket
       where bucket.id = 'teaching-case-media-private'
         and bucket.public is false
    ) then
      if exists (
        select 1
          from storage.buckets as bucket
         where bucket.id = 'teaching-case-media-private'
           and bucket.public is true
      ) then
        raise exception using
          errcode = '55000',
          message = 'Private teaching-media bucket is public; refusing metadata cutover';
      end if;
      raise exception using
        errcode = '55000',
        message = 'Private teaching-media bucket is missing; refusing metadata cutover';
    end if;

    if exists (
      select 1
        from pg_temp.private_media_cutover_refs as ref
       where not exists (
         select 1
           from storage.objects as object
          where object.bucket_id = 'teaching-case-media-private'
            and object.name = ref.storage_path
       )
    ) then
      raise exception using
        errcode = '55000',
        message = 'Private teaching-media objects are incomplete; run the copy preparation first';
    end if;
  end if;
end;
$$;

update public.cases as c
   set attachments = pg_temp.cutover_attachment_array(c.attachments),
       patient_context = case
         when jsonb_typeof(c.patient_context -> 'attachments') = 'array'
           then jsonb_set(
             c.patient_context,
             '{attachments}',
             pg_temp.cutover_attachment_array(c.patient_context -> 'attachments'),
             false
           )
         else c.patient_context
       end
 where exists (
         select 1
           from jsonb_array_elements(
             case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end
           ) as item
          where pg_temp.private_media_key(item.value ->> 'url') is not null
             or pg_temp.private_media_key(item.value ->> 'sourceUrl') is not null
       )
    or exists (
         select 1
           from jsonb_array_elements(
             case when jsonb_typeof(c.patient_context -> 'attachments') = 'array'
                  then c.patient_context -> 'attachments'
                  else '[]'::jsonb
             end
           ) as item
          where pg_temp.private_media_key(item.value ->> 'url') is not null
             or pg_temp.private_media_key(item.value ->> 'sourceUrl') is not null
       );

-- Idempotence check: no eligible old public reference may remain after the
-- update. Genuine external citations do not match private_media_key and are
-- intentionally untouched.
do $$
begin
  if exists (
    select 1
      from public.cases as c
     where exists (
             select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end
               ) as item
              where pg_temp.private_media_key(item.value ->> 'url') is not null
                 or pg_temp.private_media_key(item.value ->> 'sourceUrl') is not null
           )
        or exists (
             select 1
               from jsonb_array_elements(
                 case when jsonb_typeof(c.patient_context -> 'attachments') = 'array'
                      then c.patient_context -> 'attachments'
                      else '[]'::jsonb
                 end
               ) as item
              where pg_temp.private_media_key(item.value ->> 'url') is not null
                 or pg_temp.private_media_key(item.value ->> 'sourceUrl') is not null
           )
  ) then
    raise exception using
      errcode = '55000',
      message = 'Private teaching-media metadata cutover did not remove every old public reference';
  end if;
end;
$$;

commit;
