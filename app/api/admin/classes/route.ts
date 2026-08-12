import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { classInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdmin(); return Response.json({ classes: await getRepository().listClasses() }); }
  catch (error) { return errorResponse(error); }
}

async function save(request: Request) {
  const admin = await requireAdmin();
  const body = await request.json() as Record<string, unknown>;
  const parsed = classInputSchema.safeParse({ ...body, id: body.id ?? body.classId });
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid class." }, { status: 400 });
  return Response.json({ teachingClass: await getRepository().saveClass({ ...parsed.data, createdBy: admin.id }) });
}

export async function POST(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
