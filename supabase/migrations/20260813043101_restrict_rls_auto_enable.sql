-- This event-trigger function is infrastructure, not a Data API endpoint.
-- Keep the trigger intact while removing default RPC execution privileges.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
