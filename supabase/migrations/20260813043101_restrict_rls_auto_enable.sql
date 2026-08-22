-- This event-trigger function is infrastructure, not a Data API endpoint.
-- Keep the trigger intact while removing default RPC execution privileges.
-- Some hosted projects created this helper outside the repository's migration
-- history, so a clean local database may not contain it. Guard the revoke so
-- the migration remains reproducible from scratch without recreating a
-- privileged function that the application does not need.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
