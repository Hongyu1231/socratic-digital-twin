import { requireAdmin } from "@/lib/auth";
import { getHumanizationStore } from "@/lib/experiments/store";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { freezeDatasetSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export async function GET() { try { await requireAdmin(); return Response.json({ datasets: (await getHumanizationStore().overview()).datasets }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { const identity = await requireAdmin(); const parsed = freezeDatasetSchema.parse(await request.json()); const sessions = (await getRepository().listSessions()).filter((item) => item.session.status === "completed" && item.sessionReview?.status === "completed"); return Response.json({ dataset: await getHumanizationStore().createDataset({ ...parsed, actorId: identity.id, sessions }) }, { status: 201 }); } catch (error) { return errorResponse(error); } }
