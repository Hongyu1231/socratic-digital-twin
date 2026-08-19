import { requireAdmin } from "@/lib/auth";
import type { ClinicalCase } from "@/lib/domain";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { caseInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdmin(); return Response.json({ cases: await getRepository().listCaseVersions() }); }
  catch (error) { return errorResponse(error); }
}

async function save(request: Request) {
  const admin = await requireAdmin();
  const body = await request.json() as Record<string, unknown>;
  const id = typeof (body.id ?? body.caseId) === "string" ? String(body.id ?? body.caseId) : "";
  if (body.status === "archived" && id) return Response.json({ case: await getRepository().archiveCase(id) });
  const parsed = caseInputSchema.safeParse({ ...body, id: id || undefined });
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "A complete five-phase case is required." }, { status: 400 });
  const current = id ? await getRepository().getCase(id) : null;
  const clinicalCase: ClinicalCase = {
    ...parsed.data,
    id,
    status: "draft",
    sourceCaseId: current?.sourceCaseId ?? null,
    version: current?.version ?? 1,
    publishedAt: null,
    attachments: parsed.data.attachments.map((attachment) => ({
      ...attachment,
      id: attachment.id ?? crypto.randomUUID(),
    })),
    phases: parsed.data.phases.map((phase) => ({ ...phase, id: phase.id ?? "", caseId: id })),
  };
  return Response.json({ case: await getRepository().saveCase(clinicalCase, admin.id) });
}

export async function POST(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
