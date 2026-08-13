import { requireAdmin } from "@/lib/auth";
import { getHumanizationStore } from "@/lib/experiments/store";
import { errorResponse } from "@/lib/http";
import { tutorCandidateSchema } from "@/lib/schemas";
export const runtime = "nodejs";
export async function GET() { try { await requireAdmin(); return Response.json({ candidates: (await getHumanizationStore().overview()).candidates }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { const identity = await requireAdmin(); const parsed = tutorCandidateSchema.parse(await request.json()); return Response.json({ candidate: await getHumanizationStore().createCandidate({ ...parsed, actorId: identity.id }) }, { status: 201 }); } catch (error) { return errorResponse(error); } }
