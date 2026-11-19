import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { mustChangePassword, passwordChangeAction, SET_PASSWORD_PATH } from "@/lib/sign-in";
import { resolveSupabaseAuthConfig, type SupabaseAuthEnv } from "@/lib/supabase/auth-config";

/**
 * Refreshes the Supabase session cookies for this request, following
 * Supabase's Next.js middleware guide. Returns undefined (let the request
 * through untouched) when Supabase Auth is not configured.
 */
export async function refreshSupabaseSession(
  request: NextRequest,
  env: SupabaseAuthEnv,
): Promise<NextResponse | undefined> {
  const config = resolveSupabaseAuthConfig(env);
  if (!config) return undefined;

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between creating the client and getClaims(): it is what
  // refreshes an expired session and writes the new cookies.
  let claims: Record<string, unknown> | undefined;
  try {
    const { data, error } = await supabase.auth.getClaims();
    claims = error ? undefined : (data?.claims as Record<string, unknown> | undefined);
  } catch {
    // An Auth outage must not take the whole site down. getIdentity verifies
    // the user again and refuses access when it cannot.
  }

  // Admin-created accounts must pick their own password before anything else.
  if (claims && mustChangePassword(claims.app_metadata)) {
    const action = passwordChangeAction(request.nextUrl.pathname);
    if (action === "forbid") {
      return withSessionCookies(
        NextResponse.json({ error: "Change your password before continuing." }, { status: 403, headers: { "Cache-Control": "no-store" } }),
        response,
      );
    }
    if (action === "redirect") {
      return withSessionCookies(NextResponse.redirect(new URL(SET_PASSWORD_PATH, request.url)), response);
    }
  }

  return response;
}

/** Copies any refreshed session cookies onto a replacement response. */
function withSessionCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  target.headers.set("Cache-Control", "private, no-store");
  return target;
}
