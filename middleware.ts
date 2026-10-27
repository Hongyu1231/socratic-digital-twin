import type { NextRequest } from "next/server";

import { refreshSupabaseSession } from "@/lib/supabase/session-refresh";

export async function middleware(request: NextRequest) {
  // Each variable is read by name so the Edge runtime exposes it.
  return refreshSupabaseSession(request, {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

// Runs on every page and API route. Skips build assets, the image optimiser,
// /media and public files (images, fonts, icons, captions), which need no session.
export const config = {
  matcher: [
    "/((?!_next/static/|_next/image(?:/|$)|media/|favicon\\.svg$|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|vtt|webmanifest)$).*)",
  ],
};
