import type { ClinicalCase } from "@/lib/domain";

export function getCaseLineageId(clinicalCase: Pick<ClinicalCase, "id" | "sourceCaseId">) {
  return clinicalCase.sourceCaseId ?? clinicalCase.id;
}

export function getNextCaseVersion(cases: Array<Pick<ClinicalCase, "id" | "sourceCaseId" | "version">>, source: Pick<ClinicalCase, "id" | "sourceCaseId" | "version">) {
  const lineageId = getCaseLineageId(source);
  const lineageVersions = cases
    .filter((candidate) => getCaseLineageId(candidate) === lineageId)
    .map((candidate) => candidate.version ?? 1);
  return Math.max(source.version ?? 1, ...lineageVersions) + 1;
}

export function getVersionedCaseTitle(title: string, version: number) {
  const baseTitle = title.replace(/\s+v\d+$/i, "").trim();
  return `${baseTitle} v${version}`;
}

export function buildCaseVersionSlug(title: string, version: number, caseId: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "clinical-case";
  const stableId = caseId.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!stableId) throw new Error("A case ID is required to build a unique slug.");
  return `${base}-v${version}-${stableId}`;
}
