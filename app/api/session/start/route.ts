import { requireStudent } from "@/lib/auth";
import { errorResponse, studentView } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { startSessionSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await requireStudent();
    const parsed = startSessionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Select a valid case." }, { status: 400 });
    const repository = getRepository();
    if (parsed.data.assignmentId) {
      const bundle = await repository.createSessionForAssignment(identity.id, parsed.data.assignmentId);
      return Response.json(studentView(bundle), { status: 201 });
    }
    return Response.json({ error: "Select a valid class assignment." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
