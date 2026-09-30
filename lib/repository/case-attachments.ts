import type { CaseAttachment } from "@/lib/domain";
import { caseAttachmentInputSchema } from "@/lib/schemas";

/** Safe, admin-only diagnostics for malformed persisted media metadata. */
export interface CaseAttachmentDiagnostic {
  caseId: string;
  attachmentId: string | null;
  index: number;
  reasons: string[];
}

export interface StoredAttachmentInspection {
  valid: CaseAttachment[];
  diagnostics: CaseAttachmentDiagnostic[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STORED_ATTACHMENTS = 12;
const MAX_DIAGNOSTIC_REASONS = 8;
const MAX_REASON_LENGTH = 240;

function attachmentId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && UUID_RE.test(id.trim()) ? id.trim().toLowerCase() : null;
}

function reasonsForParse(error: { issues?: Array<{ path: PropertyKey[]; message: string }> }) {
  return (error.issues ?? []).slice(0, MAX_DIAGNOSTIC_REASONS).map((issue) => {
    const path = issue.path.map((part) => String(part)).join(".");
    const reason = path ? `${path}: ${issue.message}` : issue.message;
    return reason.slice(0, MAX_REASON_LENGTH);
  });
}

/**
 * Validate data already stored in the database without throwing. Invalid
 * entries are omitted from learner-facing output and represented only by
 * bounded diagnostics (IDs, indexes, and validation messages).
 */
export function inspectStoredAttachments(caseId: string, raw: unknown, allowedUnlockPhases?: Iterable<number>): StoredAttachmentInspection {
  const diagnostics: CaseAttachmentDiagnostic[] = [];
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    diagnostics.push({ caseId, attachmentId: null, index: 0, reasons: ["attachments: stored attachments must be an array"] });
    return { valid: [], diagnostics };
  }
  const values = Array.isArray(raw) ? raw : [];
  const boundedValues = values.slice(0, MAX_STORED_ATTACHMENTS);
  const allowedPhases = allowedUnlockPhases ? new Set(allowedUnlockPhases) : null;
  if (values.length > MAX_STORED_ATTACHMENTS) {
    diagnostics.push({ caseId, attachmentId: null, index: MAX_STORED_ATTACHMENTS, reasons: ["attachments: stored attachment count exceeds the maximum of 12"] });
  }
  const candidates: Array<{ index: number; id: string; attachment: CaseAttachment }> = [];

  boundedValues.forEach((value, index) => {
    const parsed = caseAttachmentInputSchema.safeParse(value);
    const id = attachmentId(value);
    if (!parsed.success) {
      diagnostics.push({ caseId, attachmentId: id, index, reasons: reasonsForParse(parsed.error) });
      return;
    }
    if (!parsed.data.id) {
      diagnostics.push({ caseId, attachmentId: null, index, reasons: ["id: stored attachments must have a stable ID"] });
      return;
    }
    if (allowedPhases && parsed.data.unlockPhase !== undefined && !allowedPhases.has(parsed.data.unlockPhase)) {
      diagnostics.push({ caseId, attachmentId: parsed.data.id.toLowerCase(), index, reasons: ["unlockPhase: stored attachment references a phase not present in this case"] });
      return;
    }
    candidates.push({ index, id: parsed.data.id.trim().toLowerCase(), attachment: parsed.data as CaseAttachment });
  });

  const indexesById = new Map<string, number[]>();
  for (const candidate of candidates) {
    indexesById.set(candidate.id, [...(indexesById.get(candidate.id) ?? []), candidate.index]);
  }
  const duplicateIndexes = new Set<number>();
  for (const [id, indexes] of indexesById) {
    if (indexes.length < 2) continue;
    indexes.forEach((index) => duplicateIndexes.add(index));
    indexes.forEach((index) => diagnostics.push({
      caseId,
      attachmentId: id,
      index,
      reasons: ["id: duplicate stored attachment ID"],
    }));
  }

  return {
    valid: candidates.filter((candidate) => !duplicateIndexes.has(candidate.index)).map((candidate) => candidate.attachment),
    diagnostics,
  };
}

/**
 * Validate and assign IDs at a write boundary. Existing IDs are preserved;
 * an omitted ID is generated once here and then persisted by the caller.
 */
export function normalizeWritableAttachments(caseId: string, raw: unknown): CaseAttachment[] {
  const values = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) throw new Error(`Case ${caseId} attachments must be an array.`);
  if (values.length > MAX_STORED_ATTACHMENTS) throw new Error(`Case ${caseId} cannot contain more than 12 attachments.`);
  const output: CaseAttachment[] = [];
  const ids = new Set<string>();
  for (const [index, value] of values.entries()) {
    const parsed = caseAttachmentInputSchema.safeParse(value);
    if (!parsed.success) {
      const reasons = reasonsForParse(parsed.error);
      throw new Error(`Invalid case attachment ${index + 1} for ${caseId}: ${reasons.join("; ")}`);
    }
    const id = parsed.data.id?.trim() || crypto.randomUUID();
    const normalizedId = id.toLowerCase();
    if (ids.has(normalizedId)) throw new Error(`Case ${caseId} contains duplicate media attachment IDs.`);
    ids.add(normalizedId);
    output.push({ ...(parsed.data as CaseAttachment), id });
  }
  return output;
}

export function reportAttachmentDiagnostics(diagnostics: CaseAttachmentDiagnostic[]) {
  for (const diagnostic of diagnostics) {
    console.warn("[case-integrity] Invalid stored case attachment", {
      caseId: diagnostic.caseId,
      attachmentId: diagnostic.attachmentId,
      index: diagnostic.index,
      reasons: diagnostic.reasons,
    });
  }
}
