import { AuthError, getIdentity } from "@/lib/auth";
import { CaseMediaError, isAttachmentId, resolveStudentMediaAttachment, type CaseMediaAttachment } from "@/lib/case-media";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { assertSessionAccess } from "@/lib/session-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Issue a short-lived URL after student ownership or staff class authorization.
 * The browser supplies only the session and attachment identifiers;
 * the storage object key is read from the server-side case row.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const identity = await getIdentity();
    if (!identity) throw new AuthError(401);
    const { id: sessionId, attachmentId } = await params;

    if (!isAttachmentId(attachmentId)) {
      return Response.json({ error: "Teaching attachment not found." }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS });
    }

    const repository = getRepository();
    const bundle = await repository.getSession(sessionId);
    if (!bundle) {
      return Response.json({ error: "Session not found." }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS });
    }
    await assertSessionAccess(identity, bundle, repository);

    const attachment = (bundle.case.attachments ?? []).find((candidate) => candidate.id === attachmentId) as CaseMediaAttachment | undefined;
    if (!attachment) {
      return Response.json({ error: "Teaching attachment not found." }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS });
    }

    const result = await resolveStudentMediaAttachment(bundle, attachment);
    return Response.json(result, { status: 200, headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof CaseMediaError) {
      // Do not reveal whether a valid object exists but is still phase-locked.
      return Response.json({ error: error.status === 404 ? "Teaching attachment not found." : error.message }, { status: error.status, headers: PRIVATE_NO_STORE_HEADERS });
    }
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
}
