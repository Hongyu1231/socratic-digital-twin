import { requireStudent } from "@/lib/auth";
import { errorResponse, studentView } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireStudent();
    const { id } = await params;
    const repository = getRepository();
    const bundle = await repository.getSession(id);
    if (!bundle) return Response.json({ error: "Session not found." }, { status: 404 });
    if (bundle.session.studentId !== identity.id) {
      return Response.json({ error: "This session belongs to another learner." }, { status: 403 });
    }
    return Response.json(studentView(await repository.setSessionPaused(id, null)));
  } catch (error) {
    return errorResponse(error);
  }
}
