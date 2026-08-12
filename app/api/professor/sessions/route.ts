import { requireProfessor } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await requireProfessor();
    return Response.json({ sessions: await getRepository().listSessionsForProfessor(identity.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
