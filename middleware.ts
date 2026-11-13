import type { NextRequest } from "next/server";

import { checkSiteGate } from "@/lib/site-gate";
import { refreshSupabaseSession } from "@/lib/supabase/session-refresh";

// Temporary: remove the site gate (and lib/site-gate.ts) once Supabase Auth
// replaces the demo identity switcher.
export async function middleware(request: NextRequest) {
  // Each variable is read by name so the Edge runtime exposes it.
  const gateResponse = await checkSiteGate(request.headers.get("authorization"), {
    SITE_GATE_PASSWORD: process.env.SITE_GATE_PASSWORD,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
  });
  if (gateResponse) return gateResponse;

  return refreshSupabaseSession(request, {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

// Everything is gated, including /_next/image and every API route, except
// immutable build assets and the favicon.
export const config = {
  matcher: ["/((?!_next/static/|favicon\\.svg$).*)"],
};
