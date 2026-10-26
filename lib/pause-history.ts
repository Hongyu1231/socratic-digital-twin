import type { PauseInterval } from "@/lib/domain";

/**
 * Pause history lives in sessions.context.pauseHistory (no migration). These
 * helpers are pure so the memory and Supabase repositories behave the same.
 */

export function parsePauseHistory(raw: unknown): PauseInterval[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { pausedAt, resumedAt } = entry as Record<string, unknown>;
    if (typeof pausedAt !== "string" || Number.isNaN(Date.parse(pausedAt))) return [];
    return typeof resumedAt === "string" && !Number.isNaN(Date.parse(resumedAt)) ? [{ pausedAt, resumedAt }] : [{ pausedAt }];
  });
}

const hasOpenPause = (history: PauseInterval[]) => history.some((entry) => !entry.resumedAt);

/** Start a pause. A second pause while already paused keeps the original entry. */
export function recordPause(history: PauseInterval[], at: string): PauseInterval[] {
  return hasOpenPause(history) ? history : [...history, { pausedAt: at }];
}

/**
 * End the open pause at `at`. When a session was paused before history was
 * kept, the "paused right now" time still tells us when that pause began.
 */
export function closePause(history: PauseInterval[], currentPausedAt: string | null | undefined, at: string): PauseInterval[] {
  if (hasOpenPause(history)) return history.map((entry) => entry.resumedAt ? entry : { ...entry, resumedAt: at });
  return currentPausedAt ? [...history, { pausedAt: currentPausedAt, resumedAt: at }] : history;
}

/** Apply a pause (pausedAt set) or a resume (pausedAt null) to the history. */
export function applyPauseChange(history: PauseInterval[], currentPausedAt: string | null | undefined, pausedAt: string | null, now: string) {
  return pausedAt ? recordPause(history, pausedAt) : closePause(history, currentPausedAt, now);
}

/**
 * Milliseconds between start and end, minus every paused interval (clipped to
 * that window). An open pause runs until `end`. If the session is paused
 * right now but has no open entry, the current pause is still taken out.
 */
export function activeMilliseconds(start: Date, end: Date, history: PauseInterval[], currentPausedAt?: string | null): number {
  const intervals = hasOpenPause(history) || !currentPausedAt ? history : [...history, { pausedAt: currentPausedAt }];
  const startMs = start.getTime();
  const endMs = end.getTime();
  // Merge overlaps so a pause is never subtracted twice.
  const ranges = intervals
    .map((entry) => [Math.max(startMs, Date.parse(entry.pausedAt)), Math.min(endMs, entry.resumedAt ? Date.parse(entry.resumedAt) : endMs)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let paused = 0;
  let coveredUntil = -Infinity;
  for (const [from, to] of ranges) {
    const begin = Math.max(from, coveredUntil);
    if (to > begin) paused += to - begin;
    coveredUntil = Math.max(coveredUntil, to);
  }
  return Math.max(0, endMs - startMs - paused);
}
