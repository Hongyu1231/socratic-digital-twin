/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaseResources } from "@/components/case-resources";
import type { ClinicalCase } from "@/lib/domain";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

const clinicalCase: Pick<ClinicalCase, "attachments" | "findings"> = {
  attachments: [
    {
      id: FIRST_ID,
      kind: "image",
      title: "First private OPG",
      description: "The first private teaching image.",
      storagePath: "cases/first/opg.webp",
    },
    {
      id: SECOND_ID,
      kind: "image",
      title: "Second private OPG",
      description: "The second private teaching image.",
      storagePath: "cases/second/opg.webp",
    },
  ],
  findings: [],
};

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("CaseResources private-media refresh races", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it("ignores a late response from a preview that was replaced", async () => {
    const requests: Array<{
      input: RequestInfo | URL;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
      requests.push({ input, signal: init?.signal as AbortSignal, resolve });
    }));

    await act(async () => root.render(createElement(CaseResources, { clinicalCase, sessionId: "session-1" })));
    const firstTrigger = container.querySelector<HTMLButtonElement>("[aria-label='Open First private OPG']")!;
    const secondTrigger = container.querySelector<HTMLButtonElement>("[aria-label='Open Second private OPG']")!;

    await act(async () => click(firstTrigger));
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(false);

    await act(async () => click(secondTrigger));
    expect(requests).toHaveLength(2);
    expect(requests[0].signal.aborted).toBe(true);
    expect(document.body.querySelector("[role='dialog'] h2")?.textContent).toBe("Second private OPG");

    await act(async () => {
      requests[0].resolve(Response.json({ attachmentId: FIRST_ID, url: "/api/media/first", expiresAt: new Date(Date.now() + 60_000).toISOString() }));
      await Promise.resolve();
    });
    expect(document.body.querySelector("[role='dialog'] h2")?.textContent).toBe("Second private OPG");
    expect(document.body.querySelector("img")).toBeNull();

    await act(async () => {
      requests[1].resolve(Response.json({ attachmentId: SECOND_ID, url: "/api/media/second", expiresAt: new Date(Date.now() + 60_000).toISOString() }));
      await Promise.resolve();
    });
    expect(document.body.querySelector("img")?.getAttribute("src")).toContain("second");
  });
});
