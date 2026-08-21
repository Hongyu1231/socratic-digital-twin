import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchJson,
  parseJson,
  validateSummary,
} from "../../functions/session-summary-worker/summary-worker-core";

const validSummary = {
  overallScore: 72,
  headline: "Evidence-led reasoning",
  narrative: "The learner connected an observation to a proportionate next step.",
  strengths: ["Used observable evidence"],
  weaknesses: [],
  nextSteps: ["State the uncertainty the next test resolves"],
  completedAllPhases: false,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("session summary worker core", () => {
  it("accepts fenced provider JSON and validates the required arrays", () => {
    expect(validateSummary(parseJson(`\`\`\`json\n${JSON.stringify(validSummary)}\n\`\`\``))).toEqual(validSummary);
    expect(() => validateSummary({ ...validSummary, strengths: [] })).toThrow(/strengths/i);
    expect(() => validateSummary({ ...validSummary, nextSteps: [] })).toThrow(/nextSteps/i);
  });

  it("aborts a provider call at its deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));

    const request = fetchJson("https://provider.invalid", { method: "POST" }, 25_000, fetcher);
    const rejection = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(25_000);

    await rejection;
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not leak provider response bodies into job errors", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      "private request details",
      { status: 504, headers: { "content-type": "text/plain" } },
    ));

    const error = await fetchJson("https://provider.invalid", { method: "POST" }, 1_000, fetcher)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Summary provider returned HTTP 504");
    expect((error as Error).message).not.toContain("private request details");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
