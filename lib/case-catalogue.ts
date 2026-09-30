import type { StudentCaseOffering } from "@/lib/domain";

type CatalogueOffering = Pick<StudentCaseOffering,
  "existingSessionId" | "existingSessionStatus" | "existingSessionPausedAt" | "availability"> & {
    case: Pick<StudentCaseOffering["case"], "id" | "status">;
  };

export interface CaseGroup<T = StudentCaseOffering> {
  primary: T;
  extras: T[];
}

/** Draft and archived cases stay out of the catalogue unless work already exists on them.
 * A superseded case remains a deliberate offering when its assignment was not
 * migrated at publish time; the repository keeps that compatibility path
 * assignment-scoped and prevents unassigned starts. */
export function isOffered(offering: CatalogueOffering) {
  return offering.case.status === "available" || offering.case.status === "superseded" || Boolean(offering.existingSessionId);
}

/** Lower is the better card to lead with: unfinished work first, then a startable assignment. */
export function offeringRank(offering: CatalogueOffering) {
  const unfinished = Boolean(offering.existingSessionId) && offering.existingSessionStatus !== "completed";
  if (unfinished && offering.availability === "open") return 0;
  if (unfinished) return 1;
  if (!offering.existingSessionId && offering.availability === "open") return 2;
  if (offering.existingSessionId) return 3;
  return 4;
}

export function sessionLabel(offering: CatalogueOffering) {
  if (offering.existingSessionStatus === "completed") return "Completed";
  if (offering.existingSessionPausedAt) return "Paused";
  return "In progress";
}

/**
 * The same case can be assigned many times over, and every assignment the
 * student has touched comes back as its own offering. Group them so the
 * catalogue shows one card per case without hiding a session in progress.
 */
export function groupByCase<T extends CatalogueOffering>(offerings: T[]): CaseGroup<T>[] {
  const groups = new Map<string, T[]>();
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
