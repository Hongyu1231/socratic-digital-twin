// Server-only settings for Supabase Auth. The publishable key is deliberately
// not a NEXT_PUBLIC variable: sign-in is handled on the server, so the browser
// never needs it.

export type SupabaseAuthEnv = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

export type SupabaseAuthConfig = { url: string; publishableKey: string };

/** Returns null when either value is missing (in-memory mode). */
export function resolveSupabaseAuthConfig(env: SupabaseAuthEnv): SupabaseAuthConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && publishableKey ? { url, publishableKey } : null;
}
