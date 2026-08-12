import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { userUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdmin(); return Response.json({ users: await getRepository().listUsers() }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = userUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid user update." }, { status: 400 });
    const { userId, ...update } = parsed.data;
    return Response.json({ user: await getRepository().updateUser(userId, update) });
  } catch (error) { return errorResponse(error); }
}
