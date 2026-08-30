/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CaseResources } from "@/components/case-resources";
import type { ClinicalCase } from "@/lib/domain";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clinicalCase: ClinicalCase = {
  id: "case-1",
  title: "Media case",
  description: "Synthetic teaching case.",
  difficulty: "intermediate",
  status: "available",
  learningObjectives: [],
  phases: [],
  attachments: [{
    id: "attachment-1",
    kind: "image",
    title: "Published OPG",
    description: "A de-identified literature image.",
    url: "https://example.com/opg.jpg",
    sourceLabel: "Published source",
    sourceUrl: "https://example.com/article",
  }],
};

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("CaseResources media dialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(CaseResources, { clinicalCase })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  async function openDialog() {
    const trigger = container.querySelector<HTMLButtonElement>("[aria-label='Open Published OPG']");
    expect(trigger).not.toBeNull();
    trigger!.focus();
    await act(async () => click(trigger!));
    return trigger!;
  }

  it("portals above the session layout, locks scrolling, and restores focus when closed", async () => {
    document.body.style.overflow = "clip";
    const trigger = await openDialog();
    const dialog = document.body.querySelector<HTMLElement>("[role='dialog']");
    const closeButton = document.body.querySelector<HTMLButtonElement>("[aria-label='Close attachment']");

    expect(dialog).not.toBeNull();
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(closeButton);

    await act(async () => {
      click(closeButton!);
      await Promise.resolve();
    });

    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.style.overflow).toBe("clip");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes with Escape or the backdrop and keeps keyboard focus inside", async () => {
    const trigger = await openDialog();
    const closeButton = document.body.querySelector<HTMLButtonElement>("[aria-label='Close attachment']")!;
    const sourceLink = document.body.querySelector<HTMLAnchorElement>("a[href='https://example.com/article']")!;

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(sourceLink);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(closeButton);

    trigger.focus();
    expect(document.activeElement).toBe(closeButton);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await openDialog();
    const dismissButton = document.body.querySelector<HTMLButtonElement>("[aria-label='Close attachment preview']")!;
    await act(async () => {
      click(dismissButton);
      await Promise.resolve();
    });
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
  });

  it("reports missing case-specific media without substituting generic resources", async () => {
    await act(async () => root.render(createElement(CaseResources, {
      clinicalCase: { ...clinicalCase, attachments: [] },
    })));

    expect(container.querySelector("[role='status']")?.textContent).toContain("No case-specific teaching media is attached yet");
    expect(container.querySelectorAll(".resource-button")).toHaveLength(0);
    expect(container.textContent).not.toContain("Clinical observation guide");
    expect(container.textContent).not.toContain("Patient history narration");
  });
});
