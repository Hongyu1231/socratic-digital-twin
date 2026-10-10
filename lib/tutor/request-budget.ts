/** Reserve time for persistence/response before the client's 45-second deadline. */
export const TUTOR_REQUEST_BUDGET_MS = 35_000;
export const TUTOR_PROVIDER_TIMEOUT_MS = 25_000;

export function startTutorRequestBudget(now = Date.now()) {
  return now + TUTOR_REQUEST_BUDGET_MS;
}

/** A second call uses only the time left, never another full 25 seconds. */
export function remainingTutorRequestMs(deadline: number, capMs = TUTOR_PROVIDER_TIMEOUT_MS, now = Date.now()) {
  const remaining = Math.floor(deadline - now);
  return remaining < 1_000 ? 0 : Math.min(remaining, capMs, TUTOR_PROVIDER_TIMEOUT_MS);
}

export function tutorProviderTimeout(timeoutMs?: number) {
  if (timeoutMs === undefined) return TUTOR_PROVIDER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Tutor request time budget is exhausted.");
  return Math.max(1, Math.min(Math.floor(timeoutMs), TUTOR_PROVIDER_TIMEOUT_MS));
}
