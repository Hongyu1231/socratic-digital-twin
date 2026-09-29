import type { SessionBundle } from "@/lib/domain";
import { prepareStudentMedia } from "@/lib/case-media";
import { studentView } from "@/lib/http";

/** Auth/ownership must be checked by the route before entering this boundary. */
export async function studentResponse(bundle: SessionBundle, status = 200) {
  const view = studentView(bundle);
  view.case.attachments = await prepareStudentMedia(bundle);
  return Response.json(view, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
