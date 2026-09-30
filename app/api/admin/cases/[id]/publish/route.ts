import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const raw = await request.text();
    let moveOpenAssignments = true;
    if (raw.trim()) {
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (body.moveOpenAssignments !== undefined && typeof body.moveOpenAssignments !== "boolean") {
        return Response.json({ error: "moveOpenAssignments must be a boolean." }, { status: 400 });
      }
      if (typeof body.moveOpenAssignments === "boolean") moveOpenAssignments = body.moveOpenAssignments;
    }
    return Response.json({ case: await getRepository().publishCase(id, moveOpenAssignments) });
  }
  catch (error) { return errorResponse(error); }
}
