import type { StudentCaseOffering } from "@/lib/domain";

export interface CaseGroup {
  primary: StudentCaseOffering;
  extras: StudentCaseOffering[];
}

/** Draft and archived cases stay out of the catalogue unless work already exists on them. */
export function isOffered(offering: StudentCaseOffering) {
  return offering.case.status === "available" || Boolean(offering.existingSessionId);
}

/** Lower is the better card to lead with: unfinished work first, then a startable assignment. */
export function offeringRank(offering: StudentCaseOffering) {
  const unfinished = Boolean(offering.existingSessionId) && offering.existingSessionStatus !== "completed";
  if (unfinished && offering.availability === "open") return 0;
  if (unfinished) return 1;
  if (!offering.existingSessionId && offering.availability === "open") return 2;
  if (offering.existingSessionId) return 3;
  return 4;
}

export function sessionLabel(offering: StudentCaseOffering) {
  if (offering.existingSessionStatus === "completed") return "Completed";
  if (offering.existingSessionPausedAt) return "Paused";
  return "In progress";
}

/**
 * The same case can be assigned many times over, and every assignment the
 * student has touched comes back as its own offering. Group them so the
 * catalogue shows one card per case without hiding a session in progress.
 */
export function groupByCase(offerings: StudentCaseOffering[]): CaseGroup[] {
  const groups = new Map<string, StudentCaseOffering[]>();
  for (const offering of offerings.filter(isOffered)) {
    const existing = groups.get(offering.case.id);
    if (existing) existing.push(offering);
    else groups.set(offering.case.id, [offering]);
  }
  return [...groups.values()].map((items) => {
    const ranked = [...items].sort((left, right) => offeringRank(left) - offeringRank(right));
    return { primary: ranked[0], extras: ranked.slice(1).filter((item) => item.existingSessionId) };
  });
}
