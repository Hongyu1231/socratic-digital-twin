import { requireProfessor } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { staffQueryInput } from "@/lib/staff-query-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireProfessor();
    const parsed = staffQueryInput(request);
    if (!parsed.success) return Response.json({ error: "Invalid session page query." }, { status: 400 });
    return Response.json(await getRepository().listStaffSessions(parsed.data, identity.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
