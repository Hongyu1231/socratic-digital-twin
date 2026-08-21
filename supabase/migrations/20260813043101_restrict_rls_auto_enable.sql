-- This event-trigger function is infrastructure, not a Data API endpoint.
-- Keep the trigger intact while removing default RPC execution privileges.
-- Some environments predate the dashboard-created helper, so a fresh local
-- database must be able to replay this migration even when it is absent.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
