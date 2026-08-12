import { requireProfessor } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { assignmentInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const professor = await requireProfessor();
    const repository = getRepository();
    const [assignments, cases, classes] = await Promise.all([repository.listAssignments(professor.id), repository.listCases(), repository.listClasses(professor.id)]);
    return Response.json({ assignments, cases, classes });
  } catch (error) { return errorResponse(error); }
}

async function save(request: Request) {
  const professor = await requireProfessor();
  const body = await request.json() as Record<string, unknown>;
  let candidate = body;
  const assignmentId = typeof (body.id ?? body.assignmentId) === "string" ? String(body.id ?? body.assignmentId) : undefined;
  if (assignmentId) {
    const current = (await getRepository().listAssignments(professor.id)).find((item) => item.id === assignmentId);
    if (!current) return Response.json({ error: "Assignment not found in your classes." }, { status: 404 });
    candidate = { ...current, ...body, id: assignmentId };
  }
  const parsed = assignmentInputSchema.safeParse({ status: "open", ...candidate, id: assignmentId });
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid assignment." }, { status: 400 });
  return Response.json({ assignment: await getRepository().saveAssignment(parsed.data, professor.id) });
}

export async function POST(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
