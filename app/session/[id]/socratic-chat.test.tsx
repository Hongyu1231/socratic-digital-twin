/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudentSessionBundle } from "@/lib/student-contract";

const { router } = vi.hoisted(() => ({
  router: {
    prefetch: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/case-resources", () => ({ CaseResources: () => null }));

import { SocraticChat } from "./socratic-chat";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_ID = "session-help-ui";
const SESSION_URL = `/api/session/${SESSION_ID}`;
const NOW = "2026-10-09T10:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function makeBundle(options: {
  canRequestHelp?: boolean;
  status?: "active" | "completed" | "abandoned";
  messages?: StudentSessionBundle["session"]["messages"];
} = {}): StudentSessionBundle {
  return {
    session: {
      id: SESSION_ID,
      caseId: "case-help-ui",
      currentPhase: 1,
      status: options.status ?? "active",
      pausedAt: null,
      canRequestHelp: options.canRequestHelp ?? true,
      messages: options.messages ?? [
        {
          id: "answer-1",
          sessionId: SESSION_ID,
          sender: "student",
          content: "I would start by comparing the supplied findings.",
          timestamp: NOW,
          turnKind: "answer",
          helpRequested: false,
        },
        {
          id: "tutor-1",
          sessionId: SESSION_ID,
          sender: "ai",
          content: "What evidence would you use first?",
          timestamp: NOW,
          turnKind: "answer",
          helpRequested: false,
        },
      ],
      summary: null,
    },
    case: {
      id: "case-help-ui",
      title: "Help UI case",
      description: "A synthetic case used only for the chat interaction tests.",
      difficulty: "foundation",
      status: "available",
      learningObjectives: [],
      version: 1,
      phases: [{
        id: "phase-1",
        order: 1,
        title: "First reasoning step",
        goal: "Connect an observation to a defensible next step.",
        phaseProgress: { criteriaMet: 1, criteriaTotal: 2, completedWithSupport: false },
      }],
      attachments: [],
      findings: [],
    },
    runtime: { tutor: "deterministic" },
    summaryGenerationStatus: "ready",
  };
}

function helpPair(): StudentSessionBundle["session"]["messages"] {
  return [
    {
      id: "help-marker-1",
      sessionId: SESSION_ID,
      sender: "student",
      content: "Requested more help",
      timestamp: NOW,
      turnKind: "help",
      helpRequested: true,
    },
    {
      id: "help-reply-1",
      sessionId: SESSION_ID,
      sender: "ai",
      content: "Imagine a colleague proposed a plan. What would you critique first?",
      timestamp: NOW,
      turnKind: "help",
      helpRequested: true,
      moveType: "hypothetical",
    },
  ];
}

function bodyOf(call: readonly unknown[]) {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("student More help interaction", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(makeBundle()));
      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "generated-help-id") });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function renderChat(initial = makeBundle()) {
    fetchMock.mockImplementationOnce((input: RequestInfo | URL) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(initial));
      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`));
    });
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(SocraticChat, { sessionId: SESSION_ID }));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function helpButton() {
    return container.querySelector<HTMLButtonElement>(".more-help-button")!;
  }

  async function click(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function setDraft(value: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Your clinical reasoning']")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    return textarea;
  }

  it("keeps the answer draft and sends a text-free Help request", async () => {
    const response = deferred<Response>();
    const initial = makeBundle({ canRequestHelp: true });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(initial));
      if (init?.method === "POST") return response.promise;
      return Promise.reject(new Error("Unexpected fetch"));
    });
    await renderChat(initial);

    const textarea = await setDraft("Keep this draft while I ask for a nudge.");
    await click(helpButton());
    const postCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(bodyOf(postCalls[0])).toEqual({ sessionId: SESSION_ID, helpRequested: true, clientRequestId: "generated-help-id" });
    expect(bodyOf(postCalls[0])).not.toHaveProperty("message");
    expect(textarea.value).toBe("Keep this draft while I ask for a nudge.");
    expect(container.querySelector(".message-list")?.textContent).not.toContain("Keep this draft");

    response.resolve(jsonResponse({ ...initial, session: { ...initial.session, canRequestHelp: false, messages: [...initial.session.messages, ...helpPair()] } }));
    await settle();
    expect(textarea.value).toBe("Keep this draft while I ask for a nudge.");
  });

  it("uses one POST when the More help button is clicked twice rapidly", async () => {
    const response = deferred<Response>();
    const initial = makeBundle();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(initial));
      if (init?.method === "POST") return response.promise;
      return Promise.reject(new Error("Unexpected fetch"));
    });
    await renderChat(initial);

    await act(async () => {
      const button = helpButton();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    response.resolve(jsonResponse({ ...initial, session: { ...initial.session, canRequestHelp: false, messages: [...initial.session.messages, ...helpPair()] } }));
    await settle();
  });

  it("reuses the unresolved ID when the main button is used after a retryable failure", async () => {
    const initial = makeBundle();
    const accepted = { ...initial, session: { ...initial.session, canRequestHelp: false, messages: [...initial.session.messages, ...helpPair()] } };
    let helpAttempts = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(initial));
      if (init?.method === "POST") {
        helpAttempts += 1;
        return Promise.resolve(helpAttempts === 1
          ? jsonResponse({ error: "More help is temporarily unavailable.", code: "HELP_GENERATION_RETRYABLE" }, 503)
          : jsonResponse(accepted));
      }
      return Promise.reject(new Error("Unexpected fetch"));
    });
    await renderChat(initial);
    await click(helpButton());
    await settle();
    const firstBody = bodyOf(fetchMock.mock.calls.find((call) => call[1]?.method === "POST")!);
    expect(container.querySelector(".message-failure")?.textContent).toContain("Try again");
    expect(helpButton().disabled).toBe(false);

    await click(helpButton());
    await settle();
    const postCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(postCalls).toHaveLength(2);
    expect(bodyOf(postCalls[1]).clientRequestId).toBe(firstBody.clientRequestId);
    expect(helpButton().disabled).toBe(true);
  });

  it("allows the explicit retry to replay after eligibility changes", async () => {
    const initial = makeBundle();
    const unavailable = { ...initial, session: { ...initial.session, canRequestHelp: false } };
    let helpAttempts = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(initial));
      if (init?.method !== "POST") return Promise.reject(new Error("Unexpected fetch"));
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.helpRequested === true) {
        helpAttempts += 1;
        return Promise.resolve(helpAttempts === 1
          ? jsonResponse({ error: "More help is temporarily unavailable.", code: "HELP_GENERATION_RETRYABLE" }, 503)
          : jsonResponse(unavailable));
      }
      return Promise.resolve(jsonResponse(unavailable));
    });
    await renderChat(initial);
    await click(helpButton());
    await settle();

    await setDraft("A separate answer changes the current eligibility.");
    const sendButton = container.querySelector<HTMLButtonElement>(".send-button")!;
    await click(sendButton);
    await settle();
    expect(helpButton().disabled).toBe(true);

    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>(".message-failure button")).find((button) => button.textContent?.includes("Try again"));
    expect(retry).toBeDefined();
    const firstHelpBody = bodyOf(fetchMock.mock.calls.find((call) => call[1]?.method === "POST" && bodyOf(call).helpRequested === true)!);
    await click(retry!);
    await settle();
    const helpCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST" && bodyOf(call).helpRequested === true);
    expect(helpCalls).toHaveLength(2);
    expect(bodyOf(helpCalls[1]).clientRequestId).toBe(firstHelpBody.clientRequestId);
  });

  it("disables Help before an answer and after the level-2 response", async () => {
    const initial = makeBundle({ canRequestHelp: false });
    await renderChat(initial);
    expect(helpButton().disabled).toBe(true);
    expect(container.querySelector("#help-availability")?.textContent).toContain("after you submit an answer");

    await act(async () => root.unmount());
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.append(container);
    const eligible = makeBundle({ canRequestHelp: true });
    const level2 = { ...eligible, session: { ...eligible.session, canRequestHelp: false, messages: [...eligible.session.messages, ...helpPair()] } };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(eligible));
      if (init?.method === "POST") return Promise.resolve(jsonResponse(level2));
      return Promise.reject(new Error("Unexpected fetch"));
    });
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(SocraticChat, { sessionId: SESSION_ID }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await click(helpButton());
    await settle();
    expect(helpButton().disabled).toBe(true);
    expect(container.querySelector("#help-availability")?.textContent).toContain("full support step");
  });

  it("labels a timeout as status-unknown and keeps the same retry path", async () => {
    const initial = makeBundle();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === SESSION_URL) return Promise.resolve(jsonResponse(initial));
      if (init?.method === "POST") return Promise.reject(Object.assign(new Error("Timed out"), { name: "TimeoutError" }));
      return Promise.reject(new Error("Unexpected fetch"));
    });
    await renderChat(initial);
    await click(helpButton());
    await settle();
    expect(container.querySelector(".message-failure")?.textContent).toContain("save status is unknown");
    expect(container.querySelector(".message-failure")?.textContent).not.toContain("was not saved");
  });
});
