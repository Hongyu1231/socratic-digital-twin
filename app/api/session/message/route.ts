import { requireStudent } from "@/lib/auth";
import { errorResponse, studentView } from "@/lib/http";
import { sessionMessageSchema } from "@/lib/schemas";
import { submitStudentAnswer } from "@/lib/tutor/state-machine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await requireStudent();
    const parsed = sessionMessageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid answer." }, { status: 400 });
    }
    const bundle = await submitStudentAnswer(parsed.data.sessionId, identity.id, parsed.data.message, parsed.data.clientRequestId);
    return Response.json(studentView(bundle));
  } catch (error) {
    return errorResponse(error);
  }
}
