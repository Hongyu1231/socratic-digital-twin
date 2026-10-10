import { describe, expect, it } from "vitest";
import type { TutorMessage } from "@/lib/domain";
import { latestTutorRuntime } from "@/lib/tutor/runtime";
import { mapMessage } from "@/lib/repository/supabase";

const reply: TutorMessage = {
  id: "reply", sessionId: "session", sender: "ai", timestamp: "2026-10-10T00:00:00Z",
  content: "A bounded reveal. How would you apply this?", turnKind: "help",
};

describe("Help generator provenance", () => {
  it("persists and reloads fallback without inventing an evaluation", () => {
    const mapped = mapMessage({ id: reply.id, session_id: reply.sessionId, role: "ai",
      created_at: reply.timestamp, content: reply.content,
      metadata: { turnKind: "help", helpRequested: true, supportProvider: "deterministic", supportFallbackFrom: "openai" },
    });
    expect(latestTutorRuntime({ messages: [mapped], evaluations: [] }, "openai"))
      .toEqual({ tutor: "deterministic", fallbackFrom: "openai" });
  });

  it("reports successful Help generation rather than a previous answer fallback", () => {
    expect(latestTutorRuntime({ messages: [{ ...reply, supportProvider: "claude" }], evaluations: [] }, "openai"))
      .toEqual({ tutor: "claude", fallbackFrom: undefined });
  });

  it("ignores invalid persisted provider values and keeps legacy default", () => {
    const mapped = mapMessage({ id: reply.id, session_id: reply.sessionId, role: "ai",
      created_at: reply.timestamp, content: reply.content,
      metadata: { turnKind: "help", supportProvider: "invalid", supportFallbackFrom: "invalid" },
    });
    expect(latestTutorRuntime({ messages: [mapped], evaluations: [] }, "openai"))
      .toEqual({ tutor: "openai", fallbackFrom: undefined });
  });
});
