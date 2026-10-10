import { describe, expect, it } from "vitest";

import {
  HELP_BUTTON_READY_DESCRIPTION,
  helpRequestBody,
  helpUnavailableReason,
  isHelpMessage,
} from "@/app/session/[id]/help-ui";

const eligibleSession = { canRequestHelp: true, status: "active" as const, pausedAt: null };

describe("student More help UI helpers", () => {
  it("builds the text-free Help request shape", () => {
    const body = helpRequestBody("session-1", "help-request-123");

    expect(body).toEqual({
      sessionId: "session-1",
      helpRequested: true,
      clientRequestId: "help-request-123",
    });
    expect(body).not.toHaveProperty("message");
  });

  it("explains why Help is unavailable while preserving the server flag as authority", () => {
    expect(helpUnavailableReason({ ...eligibleSession, canRequestHelp: false }, false)).toContain("after you submit an answer");
    expect(helpUnavailableReason({ ...eligibleSession, pausedAt: "2026-10-09T10:00:00.000Z" }, false)).toContain("Resume");
    expect(helpUnavailableReason({ ...eligibleSession, status: "completed" }, false)).toContain("session ends");
    expect(helpUnavailableReason(eligibleSession, true)).toContain("current tutor response");
    expect(helpUnavailableReason(eligibleSession, false)).toBeNull();
    expect(HELP_BUTTON_READY_DESCRIPTION).toContain("draft");
  });

  it("recognises Help from metadata rather than the marker text", () => {
    expect(isHelpMessage({ turnKind: "help", content: "ordinary text" })).toBe(true);
    expect(isHelpMessage({ helpRequested: true, content: "ordinary text" })).toBe(true);
    expect(isHelpMessage({ content: "Requested more help" })).toBe(false);
    expect(isHelpMessage({ turnKind: "answer", helpRequested: false })).toBe(false);
  });
});
