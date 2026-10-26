import { AuthError, getIdentity } from "@/lib/auth";
import { buildPilotZip, loadPilotExportInput } from "@/lib/export/pilot-zip";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const REFUSED = "Only faculty teaching this class and admins can download its pilot data. Ask the lead professor or an admin if you need a copy.";
const message = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

/** Pilot data for one class, as a zip. Faculty in the class and admins only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await getIdentity();
    if (!identity) return message("Please sign in again, then try the download.", 401);
    if (identity.role !== "admin" && identity.role !== "professor") {
      return message(REFUSED, 403);
    }
    const { id } = await params;
    const repository = getRepository();
    const input = await loadPilotExportInput(repository, id);
    if (!input) return message("We couldn't find that class. It may have been removed, so refresh the page and try again.", 404);
    if (identity.role === "professor"
      && !input.teachingClass.members.some((member) => member.userId === identity.id && member.role === "professor")) {
      return message(REFUSED, 403);
    }
    const zip = await buildPilotZip(input);
    return new Response(new Uint8Array(zip.buffer), {
      status: 200,
      headers: {
        ...noStore,
        "Content-Type": "application/zip",
        "Content-Length": String(zip.buffer.length),
        "Content-Disposition": `attachment; filename="${zip.fileName}"; filename*=UTF-8''${encodeURIComponent(zip.fileName)}`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return message("Please sign in again, then try the download.", error.status);
    console.error("Pilot export failed", error instanceof Error ? error.message : error);
    return message("Couldn't prepare the download. Please try again in a minute.", 500);
  }
}
