import { requireAdmin } from "@/lib/auth";
import type { CaseAttachment, ClinicalCase } from "@/lib/domain";
import { errorResponse } from "@/lib/http";
import { getRepository } from "@/lib/repository";
import { caseInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CasePayload = Omit<ClinicalCase, "phases" | "attachments"> & {
  phases: ClinicalCase["phases"];
  attachments?: CaseAttachment[];
};

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanLines(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => cleanText(item)).filter((item): item is string => Boolean(item))
    : [];
}

function normalizeAttachment(value: unknown): CaseAttachment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === "audio" || record.kind === "video" ? record.kind : "image";
  const title = cleanText(record.title);
  const description = cleanText(record.description);
  const url = cleanText(record.url);
  const posterUrl = cleanText(record.posterUrl);
  const transcript = cleanText(record.transcript);
  if (!title && !description && !url && !posterUrl && !transcript) return null;
  return {
    id: cleanText(record.id) ?? crypto.randomUUID(),
    kind,
    title: title ?? "Untitled attachment",
    description: description ?? "",
    ...(url ? { url } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(transcript ? { transcript } : {}),
  };
}

function normalizeAttachments(value: unknown) {
  return Array.isArray(value)
    ? value.map(normalizeAttachment).filter((item): item is CaseAttachment => Boolean(item))
    : [];
}

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
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "A complete case with 1–12 phases is required." }, { status: 400 });
  const parsedCase = parsed.data as unknown as CasePayload;
  const rawPhases = Array.isArray(body.phases) ? body.phases : [];
  const phases = parsedCase.phases.map((phase, index) => {
    const rawPhase = rawPhases[index] && typeof rawPhases[index] === "object"
      ? rawPhases[index] as Record<string, unknown>
      : {};
    const tutorGuidance = cleanLines(phase.tutorGuidance ?? rawPhase.tutorGuidance);
    const tutorMoves = phase.tutorMoves ?? (Array.isArray(rawPhase.tutorMoves) ? rawPhase.tutorMoves : []);
    return {
      ...phase,
      order: index + 1,
      tutorGuidance,
      tutorMoves,
    };
  });
  const attachments = normalizeAttachments(parsedCase.attachments ?? body.attachments);
  const current = id ? await getRepository().getCase(id) : null;
  const clinicalCase: ClinicalCase = {
    ...parsedCase,
    id,
    status: "draft",
    sourceCaseId: current?.sourceCaseId ?? null,
    version: current?.version ?? 1,
    publishedAt: null,
    attachments,
    phases: phases.map((phase) => ({ ...phase, id: phase.id ?? "", caseId: id })),
  };
  return Response.json({ case: await getRepository().saveCase(clinicalCase, admin.id) });
}

export async function POST(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request) { try { return await save(request); } catch (error) { return errorResponse(error); } }
