import type { TutorMove } from "@/lib/domain";
import {
  CASE_DESCRIPTION_MAX_LENGTH,
  CASE_TITLE_MAX_LENGTH,
  MEDIA_URL_MAX_LENGTH,
} from "@/lib/case-limits.mjs";

export { CASE_DESCRIPTION_MAX_LENGTH, CASE_TITLE_MAX_LENGTH, MEDIA_URL_MAX_LENGTH };

export type CaseStatus = "draft" | "published" | "archived" | "available" | "superseded";
export type AttachmentKind = "image" | "audio" | "video";

export interface RubricCriterionDraft {
  id: string;
  text: string;
  revealText?: string;
}

export type RubricDraft = string | RubricCriterionDraft;

export interface CasePhaseDraft {
  id?: string;
  order: number;
  title: string;
  goal: string;
  rubric: RubricDraft[];
  acceptedExtras?: Array<{ id: string; text: string }>;
  noProgressLimit?: number;
  phaseCeiling?: number;
  starterQuestion: string;
  exampleQuestions: string[];
  tutorGuidance?: string[];
  tutorMoves?: TutorMove[];
}

export interface CaseAttachmentDraft {
  id?: string;
  kind: AttachmentKind;
  title: string;
  description: string;
  url?: string;
  posterUrl?: string;
  transcript?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  storagePath?: string;
  unlockPhase?: number;
  unlockOnRequest?: false;
}

export interface CaseFindingDraft {
  id: string;
  title: string;
  text: string;
  unlockPhase: number;
  unlockOnRequest?: false;
}

export interface CaseVersionDraft {
  id?: string;
  title: string;
  description: string;
  difficulty?: "foundation" | "intermediate" | "advanced";
  status?: CaseStatus;
  version?: number;
  learningObjectives?: string[];
  phases?: CasePhaseDraft[];
  attachments?: CaseAttachmentDraft[];
  findings?: CaseFindingDraft[];
  correctionProbes?: 1 | 2;
  publishedAt?: string | null;
  published_at?: string | null;
}

export interface CaseAttachmentDiagnostic {
  caseId: string;
  attachmentId: string | null;
  index: number;
  reasons: string[];
}

/**
 * Keep case-version actions explicit. Superseded versions remain readable and
 * clonable, but cannot be edited, published, archived, or used to move open
 * assignments from the admin list.
 */
export function caseActionPolicy(status: CaseStatus) {
  return {
    canEdit: status === "draft",
    canPublish: status === "draft",
    canClone: status === "published" || status === "available" || status === "superseded",
    canArchive: status === "draft" || status === "published" || status === "available",
  };
}

function cleanOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cloneRubric(item: RubricDraft): RubricDraft {
  return typeof item === "string" ? item : { ...item };
}

export function clonePhase(phase: CasePhaseDraft, index: number): CasePhaseDraft {
  return {
    ...phase,
    order: index + 1,
    rubric: phase.rubric.map(cloneRubric),
    acceptedExtras: phase.acceptedExtras?.map((extra) => ({ ...extra })) ?? [],
    exampleQuestions: [...phase.exampleQuestions],
    tutorGuidance: phase.tutorGuidance ? [...phase.tutorGuidance] : [],
    tutorMoves: phase.tutorMoves?.map((move) => ({
      ...move,
      classifications: move.classifications ? [...move.classifications] : undefined,
      answerIncludesAny: move.answerIncludesAny ? [...move.answerIncludesAny] : undefined,
      answerIncludesAll: move.answerIncludesAll ? [...move.answerIncludesAll] : undefined,
      answerOmitsAll: move.answerOmitsAll ? [...move.answerOmitsAll] : undefined,
      previousErrorIncludesAny: move.previousErrorIncludesAny ? [...move.previousErrorIncludesAny] : undefined,
    })) ?? [],
  };
}

export function cloneAttachment(attachment: CaseAttachmentDraft): CaseAttachmentDraft {
  return { ...attachment };
}

export function cloneFinding(finding: CaseFindingDraft): CaseFindingDraft {
  return { ...finding };
}

export function cloneCaseDraft<T extends CaseVersionDraft>(draft: T): T {
  return {
    ...draft,
    learningObjectives: draft.learningObjectives ? [...draft.learningObjectives] : [],
    phases: draft.phases?.map((phase, index) => clonePhase(phase, index)) ?? [],
    attachments: draft.attachments?.map(cloneAttachment) ?? [],
    findings: draft.findings?.map(cloneFinding) ?? [],
  } as T;
}

function cleanLines(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function cleanRubric(item: RubricDraft): RubricDraft | null {
  if (typeof item === "string") {
    const text = item.trim();
    return text || null;
  }
  return {
    id: item.id.trim(),
    text: item.text.trim(),
    ...(cleanOptional(item.revealText) ? { revealText: cleanOptional(item.revealText) } : {}),
  };
}

function cleanAttachment(attachment: CaseAttachmentDraft): CaseAttachmentDraft {
  return {
    ...(cleanOptional(attachment.id) ? { id: cleanOptional(attachment.id) } : {}),
    kind: attachment.kind,
    title: attachment.title.trim(),
    description: attachment.description.trim(),
    ...(cleanOptional(attachment.url) ? { url: cleanOptional(attachment.url) } : {}),
    ...(cleanOptional(attachment.posterUrl) ? { posterUrl: cleanOptional(attachment.posterUrl) } : {}),
    ...(cleanOptional(attachment.transcript) ? { transcript: cleanOptional(attachment.transcript) } : {}),
    ...(cleanOptional(attachment.sourceLabel) ? { sourceLabel: cleanOptional(attachment.sourceLabel) } : {}),
    ...(cleanOptional(attachment.sourceUrl) ? { sourceUrl: cleanOptional(attachment.sourceUrl) } : {}),
    ...(cleanOptional(attachment.storagePath) ? { storagePath: cleanOptional(attachment.storagePath) } : {}),
    ...(typeof attachment.unlockPhase === "number" ? { unlockPhase: attachment.unlockPhase } : {}),
    ...(attachment.unlockOnRequest === false ? { unlockOnRequest: false as const } : {}),
  };
}

function cleanFinding(finding: CaseFindingDraft): CaseFindingDraft {
  return {
    id: finding.id.trim(),
    title: finding.title.trim(),
    text: finding.text.trim(),
    unlockPhase: finding.unlockPhase,
    ...(finding.unlockOnRequest === false ? { unlockOnRequest: false as const } : {}),
  };
}

export function serializeCaseDraft<T extends CaseVersionDraft>(draft: T): T {
  return {
    ...draft,
    title: draft.title.trim(),
    description: draft.description.trim(),
    learningObjectives: cleanLines(draft.learningObjectives),
    phases: draft.phases?.map((phase, index) => ({
      ...phase,
      order: index + 1,
      title: phase.title.trim(),
      goal: phase.goal.trim(),
      rubric: phase.rubric.map(cleanRubric).filter((item): item is RubricDraft => Boolean(item)),
      acceptedExtras: (phase.acceptedExtras ?? []).map((extra) => ({ id: extra.id.trim(), text: extra.text.trim() })),
      starterQuestion: phase.starterQuestion.trim(),
      exampleQuestions: cleanLines(phase.exampleQuestions),
      tutorGuidance: cleanLines(phase.tutorGuidance),
      tutorMoves: phase.tutorMoves ?? [],
    })) ?? [],
    attachments: (draft.attachments ?? [])
      .map(cleanAttachment)
      .filter((attachment) => Boolean(attachment.title || attachment.description || attachment.url || attachment.posterUrl || attachment.transcript || attachment.storagePath)),
    findings: (draft.findings ?? []).map(cleanFinding),
  } as T;
}

export function diagnosticsForCase(diagnostics: CaseAttachmentDiagnostic[], caseId: string) {
  return diagnostics
    .filter((diagnostic) => diagnostic.caseId === caseId)
    .map((diagnostic) => ({
      ...diagnostic,
      attachmentId: diagnostic.attachmentId ?? null,
      index: diagnostic.index,
      reasons: diagnostic.reasons.slice(0, 4).map((reason) => reason.slice(0, 240)),
    }));
}

export function normalizeDiagnostics(value: unknown): CaseAttachmentDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.caseId !== "string" || !Number.isInteger(record.index) || !Array.isArray(record.reasons)) return [];
    const reasons = record.reasons.filter((reason): reason is string => typeof reason === "string");
    if (!reasons.length) return [];
    return [{
      caseId: record.caseId,
      attachmentId: typeof record.attachmentId === "string" ? record.attachmentId : null,
      index: record.index as number,
      reasons: reasons.slice(0, 4).map((reason) => reason.slice(0, 240)),
    }];
  });
}

/**
 * Persisted diagnostics remain blocking regardless of local editor changes.
 * The repository deliberately rejects implicit rewrites of malformed stored
 * rows; clearing these diagnostics requires a reviewed migration or a new
 * draft authored from a trusted source.
 */
export function diagnosticsForDraft(diagnostics: CaseAttachmentDiagnostic[], caseId: string) {
  return diagnosticsForCase(diagnostics, caseId);
}
