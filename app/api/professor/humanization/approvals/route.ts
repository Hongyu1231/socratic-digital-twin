import { requireProfessor } from "@/lib/auth";
import { getHumanizationStore } from "@/lib/experiments/store";
import { errorResponse } from "@/lib/http";
import { facultyApprovalSchema } from "@/lib/schemas";
export const runtime = "nodejs";
export async function GET() { try { const identity = await requireProfessor(); const store = getHumanizationStore(); const [overview, ready] = await Promise.all([store.overview(), store.approvalReadyRunIds()]); return Response.json({ runs: overview.runs.filter((item) => item.status === "completed" && ready.includes(item.id)), candidates: overview.candidates, approvals: overview.approvals.filter((item) => item.professorId === identity.id) }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { const identity = await requireProfessor(); const parsed = facultyApprovalSchema.parse(await request.json()); return Response.json({ approval: await getHumanizationStore().approve({ ...parsed, professorId: identity.id, professorName: identity.name }) }); } catch (error) { return errorResponse(error); } }
