import { getRepository } from "@/lib/repository";
import { errorResponse } from "@/lib/http";
import { requireStudent } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await requireStudent();
    const repository = getRepository();
    const offerings = await repository.listStudentOfferings(identity.id);
    return Response.json({ offerings, cases: offerings.map((item) => item.case), storage: repository.mode });
  } catch (error) {
    return errorResponse(error);
  }
}
