import { requireStudent } from "@/lib/auth";
import { CaseMediaError, isAttachmentId, resolveStudentMediaAttachment, type CaseMediaAttachment } from "@/lib/case-media";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Issue a short-lived URL for one attachment owned by the authenticated
 * student. The browser supplies only the session and attachment identifiers;
 * the storage object key is read from the server-side case row.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const identity = await requireStudent();
    const { id: sessionId, attachmentId } = await params;

    if (!isAttachmentId(attachmentId)) {
      return Response.json({ error: "Teaching attachment not found." }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS });
    }

    const bundle = await getRepository().getSession(sessionId);
    if (!bundle) {
      return Response.json({ error: "Session not found." }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS });
    }
    if (bundle.session.studentId !== identity.id) {
      return Response.json({ error: "This session belongs to another learner." }, { status: 403, headers: PRIVATE_NO_STORE_HEADERS });
    }

    const attachment = (bundle.case.attachments ?? []).find((candidate) => candidate.id === attachmentId) as CaseMediaAttachment | undefined;
    if (!attachment) {
      return Response.json({ error: "Teaching attachment not found." }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS });
    }

    const result = await resolveStudentMediaAttachment(bundle, attachment);
    return Response.json(result, { status: 200, headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof CaseMediaError) {
      return Response.json({ error: error.message }, { status: error.status, headers: PRIVATE_NO_STORE_HEADERS });
    }
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
}
