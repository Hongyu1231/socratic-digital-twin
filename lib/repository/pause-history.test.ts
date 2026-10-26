import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import type { SessionBundle, SessionSummary } from "@/lib/domain";
import { DEMO_ASSIGNMENT_ID, DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 1, minute)).toISOString();
const summary: SessionSummary = { overallScore: 70, headline: "", narrative: "", strengths: [], weaknesses: [], nextSteps: [], completedAllPhases: false };

afterEach(() => vi.useRealTimers());

describe("pause history in the memory repository", () => {
  it("records pause and resume, and closes an open pause when the session ends", async () => {
    const repository = new InMemoryTutorRepository();
    const { session } = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    vi.useFakeTimers();

    vi.setSystemTime(new Date(at(10)));
    let bundle = await repository.setSessionPaused(session.id, at(10));
    expect(bundle.session.pausedAt).toBe(at(10));
    expect(bundle.session.pauseHistory).toEqual([{ pausedAt: at(10) }]);

    vi.setSystemTime(new Date(at(20)));
    bundle = await repository.setSessionPaused(session.id, null);
    expect(bundle.session.pausedAt).toBeNull();
    expect(bundle.session.pauseHistory).toEqual([{ pausedAt: at(10), resumedAt: at(20) }]);

    bundle = await repository.setSessionPaused(session.id, at(30));
    bundle = await repository.completeSession(session.id, summary, at(45));
    expect(bundle.session.pausedAt).toBeNull();
    expect(bundle.session.pauseHistory).toEqual([
      { pausedAt: at(10), resumedAt: at(20) },
      { pausedAt: at(30), resumedAt: at(45) },
    ]);
  });
});

/** A Supabase repository whose client records every update payload. */
function supabaseWith(sessionRow: { status: string; context: Record<string, unknown> }, bundle: Partial<SessionBundle["session"]>) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle: async () => ({ data: sessionRow, error: null }),
        update(payload: Record<string, unknown>) { updates.push(payload); return { eq: async () => ({ error: null }) }; },
      };
      return builder;
    },
  };
  const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
  Object.defineProperty(repository, "client", { value: client });
  repository.getSession = vi.fn(async () => ({ session: { reviewStatus: "pending", ...bundle } }) as SessionBundle);
  return { repository, updates };
}

describe("pause history in the Supabase repository", () => {
  it("appends a pause and closes it on resume, keeping the paused-right-now field", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at(20)));
    const paused = supabaseWith({ status: "active", context: { score: null, pausedAt: null, pauseHistory: [{ pausedAt: at(1), resumedAt: at(2) }] } }, {});
    await paused.repository.setSessionPaused("s", at(10));
    expect(paused.updates[0]!.context).toMatchObject({ score: null, pausedAt: at(10), pauseHistory: [{ pausedAt: at(1), resumedAt: at(2) }, { pausedAt: at(10) }] });

    const resumed = supabaseWith({ status: "active", context: { pausedAt: at(10), pauseHistory: [{ pausedAt: at(10) }] } }, {});
    await resumed.repository.setSessionPaused("s", null);
    expect(resumed.updates[0]!.context).toMatchObject({ pausedAt: null, pauseHistory: [{ pausedAt: at(10), resumedAt: at(20) }] });
  });

  it("closes an open pause at the end time when completed while paused", async () => {
    const { repository, updates } = supabaseWith({ status: "active", context: {} }, { pausedAt: at(30), pauseHistory: [{ pausedAt: at(30) }] });
    await repository.completeSession("s", summary, at(45));
    expect(updates[0]).toMatchObject({ status: "completed", ended_at: at(45) });
    expect(updates[0]!.context).toMatchObject({ pausedAt: null, pauseHistory: [{ pausedAt: at(30), resumedAt: at(45) }] });
  });

  it("starts a history from the paused-right-now time for a session paused before tracking began", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at(50)));
    const { repository, updates } = supabaseWith({ status: "active", context: { pausedAt: at(40) } }, {});
    await repository.setSessionPaused("s", null);
    expect(updates[0]!.context).toMatchObject({ pausedAt: null, pauseHistory: [{ pausedAt: at(40), resumedAt: at(50) }] });
  });
});

describe("pause history survives a tutor turn", () => {
  it("passes the history through commit_tutor_turn, which replaces the whole context", async () => {
    const history = [{ pausedAt: at(10), resumedAt: at(20) }];
    let sentContext: unknown;
    const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
    Object.defineProperty(repository, "client", { value: { rpc: async (_name: string, args: Record<string, unknown>) => { sentContext = args.p_session_context; return { error: null }; } } });
    repository.getSession = vi.fn(async () => ({
      session: { studentId: "student", currentPhase: 1, reviewStatus: "pending", pauseHistory: history },
      case: { phases: [{ id: "phase-1", order: 1 }] },
    }) as unknown as SessionBundle);
    // A Help turn is the simplest valid turn: it needs no evaluation.
    const message = { id: "m", sessionId: "s", sender: "student" as const, content: "Requested more help", timestamp: at(21), turnKind: "help" as const, helpRequested: true };
    await repository.commitTurn({
      sessionId: "s", expectedVersion: 1, clientRequestId: "request-123", studentMessage: message, evaluation: null,
      aiMessage: { ...message, id: "a", sender: "ai", content: "A hint.", replyToMessageId: "m" },
      nextState: { strengths: [], previousErrors: [], version: 2 } as never,
      nextPhase: 1, status: "active", score: null, summary: null, completedAt: null,
    });
    expect(sentContext).toMatchObject({ pausedAt: null, pauseHistory: history });
  });
});
