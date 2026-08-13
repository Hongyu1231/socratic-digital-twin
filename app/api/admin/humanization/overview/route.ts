import { requireAdmin } from "@/lib/auth";
import { getHumanizationStore } from "@/lib/experiments/store";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdmin(); return Response.json(await getHumanizationStore().overview()); }
  catch (error) { return errorResponse(error); }
}
