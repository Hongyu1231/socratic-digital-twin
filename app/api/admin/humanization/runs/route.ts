import { requireAdmin } from "@/lib/auth";
import { getHumanizationStore } from "@/lib/experiments/store";
import { errorResponse } from "@/lib/http";
import { evaluationRunSchema } from "@/lib/schemas";
export const runtime = "nodejs";
export async function GET() { try { await requireAdmin(); return Response.json({ runs: (await getHumanizationStore().overview()).runs }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { const identity = await requireAdmin(); const parsed = evaluationRunSchema.parse(await request.json()); return Response.json({ run: await getHumanizationStore().runEvaluation({ ...parsed, actorId: identity.id }) }, { status: 201 }); } catch (error) { return errorResponse(error); } }
