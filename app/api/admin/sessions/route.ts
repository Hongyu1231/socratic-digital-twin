import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await requireAdmin(); return Response.json({ sessions: await getRepository().listSessions() }); }
  catch (error) { return errorResponse(error); }
}
