const GATEWAY_MESSAGE = "The server took too long to respond. Please try again in a moment.";
const NETWORK_MESSAGE = "The connection dropped before the server answered. Check your connection and try again.";
const GATEWAY_STATUSES = new Set([408, 502, 503, 504]);

/** Aborts when the caller aborts or when `timeoutMs` elapses, whichever happens first. */
export function requestSignal(timeoutMs: number, controller?: AbortController) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return controller ? AbortSignal.any([controller.signal, timeout]) : timeout;
}

/**
 * Reads a JSON body. Gateway timeouts and platform error pages answer with HTML,
 * and calling response.json() on those shows the student a parser message
 * ("Unexpected token '<'") instead of something they can act on.
 */
export async function readJsonBody<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(GATEWAY_STATUSES.has(response.status) ? GATEWAY_MESSAGE : fallbackMessage);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

/** True when a request was cancelled by its own deadline rather than by the caller. */
export function isTimeout(reason: unknown) {
  return reason instanceof Error && reason.name === "TimeoutError";
}

/** Turns a rejected fetch into a message a student can act on. */
export function describeRequestFailure(reason: unknown, fallbackMessage: string, timeoutMessage: string) {
  if (isTimeout(reason)) return timeoutMessage;
  if (reason instanceof TypeError) return NETWORK_MESSAGE;
  return reason instanceof Error ? reason.message : fallbackMessage;
}
