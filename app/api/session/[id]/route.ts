import { getIdentity } from "@/lib/auth";
import { errorResponse, studentView } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await getIdentity();
    if (!identity) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { id } = await params;
    const bundle = await getRepository().getSession(id);
    if (!bundle) return Response.json({ error: "Session not found." }, { status: 404 });
    if (identity.role === "student" && bundle.session.studentId !== identity.id) {
      return Response.json({ error: "This session belongs to another learner." }, { status: 403 });
    }
    if (identity.role === "professor") {
      const allowedBundle = (await getRepository().listSessionsForProfessor(identity.id)).find((item) => item.session.id === id);
      if (!allowedBundle) return Response.json({ error: "This session belongs to another class." }, { status: 403 });
      return Response.json(allowedBundle);
    }
    return Response.json(identity.role === "student" ? studentView(bundle) : bundle);
  } catch (error) {
    return errorResponse(error);
  }
}
