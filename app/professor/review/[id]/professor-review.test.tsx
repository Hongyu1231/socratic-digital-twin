/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfessorReview } from "@/app/professor/review/[id]/professor-review";
import type { SessionBundle, TutorMessage } from "@/lib/domain";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function message(
  id: string,
  sender: TutorMessage["sender"],
  content: string,
  extra: Partial<TutorMessage> = {},
): TutorMessage {
  return {
    id,
    sessionId: "session-1",
    sender,
    content,
    timestamp: "2026-10-09T00:00:00Z",
    ...extra,
  };
}

const bundle = {
  session: {
    id: "session-1",
    studentId: "student-1",
    caseId: "case-1",
    currentPhase: 1,
    status: "active",
    reviewStatus: "pending",
    score: 80,
    summary: null,
    createdAt: "2026-10-09T00:00:00Z",
    completedAt: null,
    messages: [
      message("opening", "ai", "Opening tutor question."),
      message("help", "student", "Requested more help", { turnKind: "help", helpRequested: true, phaseOrder: 1, supportLevel: 2, completedWithSupport: true }),
      message("help-reply", "ai", "Here is the reveal; apply it next.", { turnKind: "help", helpRequested: true, replyToMessageId: "help", phaseOrder: 1, supportLevel: 2, completedWithSupport: true }),
      message("answer", "student", "The finding is distal.", { turnKind: "answer", helpRequested: false }),
      message("answer-reply", "ai", "What supports that conclusion?", { turnKind: "answer", helpRequested: false }),
    ],
    evaluations: [{
      id: "evaluation-1",
      messageId: "answer",
      classification: "partial",
      confidence: 0.8,
      reasoningGap: "Needs evidence.",
      strategy: "probe",
      phaseComplete: false,
      feedback: "Add evidence.",
      createdAt: "2026-10-09T00:00:00Z",
    }],
    state: {
      strengths: [],
      weaknesses: [],
      previousErrors: [],
    },
  },
  case: { title: "Case 1" },
  student: { name: "Student" },
  answerReviews: [],
  tutorTurnReviews: [],
  sessionReview: null,
  runtime: { storage: "memory", tutor: "deterministic" },
  teachingClass: null,
  reviewClaim: { reviewerId: null, reviewerName: null, state: "unclaimed", canEdit: true },
  summaryGenerationStatus: "ready",
} as unknown as SessionBundle;

describe("ProfessorReview Help chronology", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bundle })));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("renders Help in chronology without answer or tutor-review controls", async () => {
    await act(async () => {
      root.render(createElement(ProfessorReview, { sessionId: "session-1" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const transcript = container.querySelector<HTMLElement>(".transcript-card");
    expect(transcript).not.toBeNull();
    expect(transcript?.textContent).toContain("Opening tutor context");
    expect(transcript?.textContent).toContain("Help requested");
    expect(transcript?.textContent).toContain("Tutor support recorded: Yes");
    expect(transcript?.textContent).toContain("Help does not itself complete the phase.");
    expect(transcript?.textContent).not.toContain("Completed with support: Yes");
    expect(transcript?.textContent).toContain("Answer 1");
    expect(transcript?.textContent).not.toContain("Answer 2");
    expect(transcript!.textContent!.indexOf("Opening tutor context")).toBeLessThan(transcript!.textContent!.indexOf("Help requested"));
    expect(transcript!.textContent!.indexOf("Help requested")).toBeLessThan(transcript!.textContent!.indexOf("Answer 1"));

    const helpTurn = [...transcript!.querySelectorAll<HTMLElement>(".review-turn")].find((turn) => turn.textContent?.includes("Help requested"));
    const answerTurn = [...transcript!.querySelectorAll<HTMLElement>(".review-turn")].find((turn) => turn.textContent?.includes("Answer 1"));
    expect(helpTurn).not.toBeUndefined();
    expect(helpTurn?.querySelector(".label-buttons")).toBeNull();
    expect(helpTurn?.querySelector("[aria-label^='Tutor quality']")).toBeNull();
    expect(answerTurn?.querySelector(".label-buttons")).not.toBeNull();
    expect(answerTurn?.querySelector("[aria-label^='Tutor quality']")).not.toBeNull();
  });

  it.each([true, false])("only labels supported completion after actual phase completion: %s", async (completed) => {
    const value = { ...bundle, case: { ...bundle.case, phases: [{ id: "phase-1", order: 1, title: "Observe the records" }] },
      session: { ...bundle.session, state: { ...bundle.session.state, phaseProgress: { "1": { completed, completedWithSupport: true, supportLevel: 2 } } } } };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => value })));
    await act(async () => {
      root.render(createElement(ProfessorReview, { sessionId: "session-1" }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const region = container.querySelector("[aria-label='Phase completion']");
    expect(region?.textContent).toContain("Observe the records");
    if (completed) expect(region?.textContent).toContain("Completed with tutor support");
    else {
      expect(region?.textContent).toContain("No completion recorded");
      expect(region?.textContent).not.toContain("Completed with tutor support");
    }
  });

  it("does not mount a partial student DTO as a professor bundle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
      case: { title: "Case 1" }, session: { id: "session-1", messages: [], summary: null }, runtime: {},
    }) })));
    await act(async () => {
      root.render(createElement(ProfessorReview, { sessionId: "session-1" }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Review unavailable");
    expect(container.textContent).toContain("Switch to a professor or administrator profile");
    expect(container.querySelector(".transcript-card")).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/session/session-1?view=professor", expect.objectContaining({ cache: "no-store" }));
  });

  it("handles a denied faculty-view request without rendering grading controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Switch to a professor profile." }) })));
    await act(async () => {
      root.render(createElement(ProfessorReview, { sessionId: "session-1" }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Review unavailable");
    expect(container.textContent).toContain("Switch to a professor profile.");
    expect(container.querySelector(".label-buttons")).toBeNull();
  });
});
