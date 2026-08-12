import { requireProfessor } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const professor = await requireProfessor(); return Response.json({ classes: await getRepository().listClasses(professor.id) }); }
  catch (error) { return errorResponse(error); }
}
