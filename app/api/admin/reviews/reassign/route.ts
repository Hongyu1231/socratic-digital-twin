import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { reviewReassignSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = reviewReassignSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid review assignment." }, { status: 400 });
    if (parsed.data.professorId) {
      const bundle = await getRepository().getSession(parsed.data.sessionId);
      const members = bundle?.teachingClass?.members ?? [];
      if (!members.some((item) => item.userId === parsed.data.professorId && item.role === "professor")) return Response.json({ error: "Reviewer must teach this class." }, { status: 403 });
    }
    return Response.json({ session: await getRepository().reassignReview(parsed.data.sessionId, parsed.data.professorId) });
  } catch (error) { return errorResponse(error); }
}
