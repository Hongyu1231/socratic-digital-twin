import { createAccount, supabaseAuthAdmin, updateAccount } from "@/lib/admin-users";
import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { userCreateSchema, userUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

export async function GET() {
  try { await requireAdmin(); return Response.json({ users: await getRepository().listUsers() }); }
  catch (error) { return errorResponse(error); }
}

/** Adds a user. The generated password is returned once and never stored in plain text. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = userCreateSchema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the new user's details." }, { status: 400 });
    const issued = await createAccount(parsed.data, { repository: getRepository(), auth: supabaseAuthAdmin() });
    return Response.json(issued, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = userUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the user's details." }, { status: 400 });
    return Response.json({ user: await updateAccount(admin, parsed.data, { repository: getRepository(), auth: supabaseAuthAdmin() }) });
  } catch (error) { return errorResponse(error); }
}
