import { requireAdmin } from "@/lib/auth";
import { getHumanizationStore } from "@/lib/experiments/store";
import { errorResponse } from "@/lib/http";
import { humanizationExperimentSchema } from "@/lib/schemas";
export const runtime = "nodejs";
export async function GET() { try { await requireAdmin(); return Response.json({ experiments: (await getHumanizationStore().overview()).experiments }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { const identity = await requireAdmin(); const body = await request.json(); if (body?.action === "pause") return Response.json({ experiment: await getHumanizationStore().pauseExperiment(String(body.experimentId)) }); const parsed = humanizationExperimentSchema.parse(body); return Response.json({ experiment: await getHumanizationStore().createExperiment({ ...parsed, actorId: identity.id }) }, { status: 201 }); } catch (error) { return errorResponse(error); } }
