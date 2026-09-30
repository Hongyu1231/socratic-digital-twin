import type {
  LearningSession,
  StaffAssignmentProgress,
  StaffReviewFilter,
  StaffSessionCursor,
  StaffSessionStats,
} from "@/lib/domain";

export type StaffReviewState = "in_progress" | "available" | "mine" | "claimed" | "completed";

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export class StaffSessionCursorError extends Error {
  readonly code = "INVALID_STAFF_SESSION_CURSOR" as const;

  constructor() {
    super("Staff session cursor is invalid.");
    this.name = "StaffSessionCursorError";
  }
}

export function normalizeStaffSessionLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(value) || value < 1) throw new Error("Staff session page limit must be a positive integer.");
  return Math.min(value, MAX_PAGE_LIMIT);
}

export function encodeStaffSessionCursor(cursor: StaffSessionCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeStaffSessionCursor(value: string | null | undefined): StaffSessionCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<StaffSessionCursor>;
    if (
      typeof parsed.createdAt !== "string"
      || !ISO_TIMESTAMP_PATTERN.test(parsed.createdAt)
      || Number.isNaN(Date.parse(parsed.createdAt))
      || typeof parsed.id !== "string"
      || !UUID_PATTERN.test(parsed.id)
    ) {
      throw new StaffSessionCursorError();
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new StaffSessionCursorError();
  }
}

export function staffReviewState(session: Pick<LearningSession, "status" | "reviewStatus" | "reviewerId">, professorId?: string): StaffReviewState {
  if (session.status !== "completed") return "in_progress";
  if (session.reviewStatus === "completed") return "completed";
  if (!session.reviewerId) return "available";
  return professorId && session.reviewerId === professorId ? "mine" : "claimed";
}

export function matchesStaffReviewFilter(state: StaffReviewState, filter: StaffReviewFilter = "all") {
  return filter === "all" || state === filter;
}

export function emptyStaffSessionStats(): StaffSessionStats {
  return { total: 0, completed: 0, reviewed: 0, available: 0, mine: 0, claimed: 0 };
}

export function accumulateStaffSessionStats(
  stats: StaffSessionStats,
  session: Pick<LearningSession, "status" | "reviewStatus" | "reviewerId">,
  professorId?: string,
) {
  stats.total += 1;
  if (session.status === "completed") stats.completed += 1;
  const state = staffReviewState(session, professorId);
  if (state === "completed") stats.reviewed += 1;
  if (state === "available") stats.available += 1;
  if (state === "mine") stats.mine += 1;
  if (state === "claimed") stats.claimed += 1;
}

export function addAssignmentProgress(
  progress: Record<string, StaffAssignmentProgress>,
  assignmentId: string | null | undefined,
  status: LearningSession["status"],
) {
  if (!assignmentId) return;
  const current = progress[assignmentId] ?? { sessionCount: 0, completedCount: 0 };
  current.sessionCount += 1;
  if (status === "completed") current.completedCount += 1;
  progress[assignmentId] = current;
}

export function isAfterStaffCursor(createdAt: string, id: string, cursor: StaffSessionCursor | null) {
  if (!cursor) return true;
  return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && id < cursor.id);
}

export const STAFF_SESSION_PAGE_MAX = MAX_PAGE_LIMIT;
