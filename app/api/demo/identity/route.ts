import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { DEMO_SESSION_COOKIE_NAME, signSession } from "@/lib/auth";
import { getRepository } from "@/lib/repository";

const roleSwitchSchema = z.object({
  userId: z.string().uuid(),
}).strict();

export const runtime = "nodejs";

export async function GET() {
  try {
    const users = (await getRepository().listUsers()).filter((user) => user.isActive !== false);
    return NextResponse.json({ users });
  } catch {
    return NextResponse.json({ users: [] });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = roleSwitchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Select a valid demo user.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const identity = (await getRepository().listUsers()).find((user) => user.id === parsed.data.userId && user.isActive !== false);
  if (!identity) return NextResponse.json({ error: "This demo identity is unavailable." }, { status: 403 });
  const role = identity.role;
  const token = signSession({ userId: identity.id, role });
  const cookieStore = await cookies();

  cookieStore.set(DEMO_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return NextResponse.json({ identity });
}
