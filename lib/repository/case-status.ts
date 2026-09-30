export type PersistedCaseStatus = "draft" | "active" | "archived" | "superseded";
export type CaseStatusTransition = "publish" | "archive" | "supersede";

/** Explicit application-level transition allowlist; SQL enforces the same. */
export const CASE_STATUS_TRANSITIONS: Record<CaseStatusTransition, readonly PersistedCaseStatus[]> = {
  publish: ["draft"],
  archive: ["draft", "active"],
  supersede: ["active"],
};

export function assertCaseStatusTransition(transition: CaseStatusTransition, status: string): asserts status is PersistedCaseStatus {
  const allowed = CASE_STATUS_TRANSITIONS[transition];
  if (allowed.includes(status as PersistedCaseStatus)) return;
  if (status === "active" && transition === "publish") throw new Error("Case is already published.");
  if (status === "archived") throw new Error("Case is already archived.");
  if (status === "superseded") throw new Error("Case version is already superseded.");
  throw new Error(`Case status ${status} cannot be ${transition}ed.`);
}
