import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { resolveSupabaseAuthConfig } from "@/lib/supabase/auth-config";

/**
 * Supabase Auth client for Server Components and route handlers, reading and
 * writing the session cookies through next/headers. Returns null when Supabase
 * Auth is not configured. Use this only to verify who is signed in; data access
 * stays with the service-role repository.
 */
export async function createSupabaseAuthClient() {
  const config = resolveSupabaseAuthConfig({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  if (!config) return null;

  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session, so skipping the write here is safe.
        }
      },
    },
  });
}
