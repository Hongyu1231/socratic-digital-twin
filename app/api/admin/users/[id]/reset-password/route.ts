import { z } from "zod";

import { resetPassword, supabaseAuthAdmin } from "@/lib/admin-users";
import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issues a new generated password (shown once) and sets the must-change mark. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "That user no longer exists." }, { status: 404 });
    const issued = await resetPassword(id, { repository: getRepository(), auth: supabaseAuthAdmin() });
    return Response.json(issued, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
