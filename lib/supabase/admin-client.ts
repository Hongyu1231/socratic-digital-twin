import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for Auth admin calls (server only). Returns
 * null when the service-role settings are missing.
 */
export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
