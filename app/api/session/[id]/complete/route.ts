import { requireStudent } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { studentResponse } from "@/lib/student-response";
import { finishSession } from "@/lib/tutor/state-machine";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireStudent();
    const { id } = await params;
    return await studentResponse(await finishSession(id, identity.id));
  } catch (error) {
    return errorResponse(error);
  }
}
