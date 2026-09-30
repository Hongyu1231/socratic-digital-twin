import { getIdentity } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { studentResponse } from "@/lib/student-response";
import { getRepository } from "@/lib/repository";
import { assertSessionAccess } from "@/lib/session-access";
import { prepareStudentMedia } from "@/lib/case-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await getIdentity();
    if (!identity) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { id } = await params;
    const repository = getRepository();
    const bundle = await repository.getSession(id);
    if (!bundle) return Response.json({ error: "Session not found." }, { status: 404 });
    await assertSessionAccess(identity, bundle, repository);
    if (identity.role === "student") return await studentResponse(bundle);
    // Staff retain their evaluation data, but session media uses the same
    // short-lived URL / phase-unlock boundary and never returns storage keys.
    return Response.json({
      ...bundle,
      case: { ...bundle.case, attachments: await prepareStudentMedia(bundle) },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
