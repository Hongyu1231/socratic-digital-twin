import { getRepository } from "@/lib/repository";
import { errorResponse } from "@/lib/http";
import { requireStudent } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await requireStudent();
    const repository = getRepository();
    const offerings = await repository.listStudentOfferings(identity.id);
    // `offerings` already embeds each case. Returning a second `cases` array
    // duplicated almost half of the uncompressed catalogue payload, while no
    // current client consumed it. The catalogue is identity-scoped and must
    // never be stored by a browser or intermediary cache.
    return Response.json(
      { offerings },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
