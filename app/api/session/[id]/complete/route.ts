import { requireStudent } from "@/lib/auth";
import { errorResponse, studentView } from "@/lib/http";
import { finishSession } from "@/lib/tutor/state-machine";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireStudent();
    const { id } = await params;
    return Response.json(studentView(await finishSession(id, identity.id)));
  } catch (error) {
    return errorResponse(error);
  }
}
