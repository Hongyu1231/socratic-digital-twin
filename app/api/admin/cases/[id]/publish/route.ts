import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); const { id } = await params; return Response.json({ case: await getRepository().publishCase(id) }); }
  catch (error) { return errorResponse(error); }
}
