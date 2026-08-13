import { requireAdmin } from "@/lib/auth";
import { getHumanizationStore } from "@/lib/experiments/store";
import { errorResponse } from "@/lib/http";
import { tutorReleaseSchema, tutorRollbackSchema } from "@/lib/schemas";
export const runtime = "nodejs";
export async function GET() { try { await requireAdmin(); return Response.json({ releases: (await getHumanizationStore().overview()).releases }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { const identity = await requireAdmin(); const parsed = tutorReleaseSchema.parse(await request.json()); return Response.json({ release: await getHumanizationStore().release({ ...parsed, actorId: identity.id }) }, { status: 201 }); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request) { try { const identity = await requireAdmin(); const parsed = tutorRollbackSchema.parse(await request.json()); return Response.json({ release: await getHumanizationStore().rollback({ ...parsed, actorId: identity.id }) }); } catch (error) { return errorResponse(error); } }
