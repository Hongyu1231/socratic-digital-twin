export type HelpSessionState = {
  canRequestHelp: boolean;
  pausedAt?: string | null;
  status: "active" | "completed" | "abandoned";
};

export const HELP_BUTTON_READY_DESCRIPTION =
  "Ask the tutor for one more nudge. Your answer draft will stay in place.";

/**
 * Keep the reason for a disabled Help action visible to the learner. The
 * server-provided flag remains the source of truth; these client-side checks
 * only explain the current UI state and avoid an unnecessary request.
 */
export function helpUnavailableReason(
  session: HelpSessionState,
  pending: boolean,
): string | null {
  if (pending) return "Wait for the current tutor response to finish.";
  if (session.pausedAt) return "Resume the session before asking for more help.";
  if (session.status !== "active") return "More help is unavailable after this session ends.";
  if (!session.canRequestHelp) {
    return "More help becomes available after you submit an answer in this phase. It is unavailable after the tutor's full support step.";
  }
  return null;
}

/** Help requests deliberately contain no `message`, including an empty one. */
export function helpRequestBody(sessionId: string, clientRequestId: string) {
  return { sessionId, helpRequested: true as const, clientRequestId };
}

export function isHelpMessage(message: { turnKind?: string; helpRequested?: boolean; content?: string }) {
  return message.turnKind === "help" || message.helpRequested === true;
}
