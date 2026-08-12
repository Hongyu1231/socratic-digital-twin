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
      const offering = (await repository.listStudentOfferings(identity.id))
        .find((item) => item.assignment.id === parsed.data.assignmentId);
      if (!offering) return Response.json({ error: "This class assignment is not available to you." }, { status: 403 });
      const bundle = await repository.createSession(identity.id, offering.case.id, offering.assignment.id);
      return Response.json(studentView(bundle), { status: 201 });
    }
    return Response.json({ error: "Select a valid class assignment." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
