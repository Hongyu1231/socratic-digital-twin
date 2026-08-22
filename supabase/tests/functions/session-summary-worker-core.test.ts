import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOpenAiResponsesBody,
  extractOpenAiResponseText,
  fetchJson,
  OPENAI_RESPONSES_URL,
  parseJson,
  parseSummaryProvider,
  reconcileGeneratedSummary,
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
  it("builds a strict Responses API request for a non-empty summary", () => {
    const body = buildOpenAiResponsesBody({ session: { id: "session-1" } }, "gpt-5.6-luna");

    expect(OPENAI_RESPONSES_URL).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "session_summary",
          strict: true,
          schema: {
            additionalProperties: false,
            properties: {
              strengths: { minItems: 1 },
              nextSteps: { minItems: 1 },
            },
          },
        },
      },
    });
    expect(JSON.parse(body.input)).toEqual({ session: { id: "session-1" } });
  });

  it("extracts structured text from both Responses API representations", () => {
    const text = JSON.stringify(validSummary);
    expect(extractOpenAiResponseText({ status: "completed", output_text: text })).toBe(text);
    expect(extractOpenAiResponseText({
      status: "completed",
      output: [{ content: [{ type: "output_text", text }] }],
    })).toBe(text);
    expect(() => extractOpenAiResponseText({ status: "incomplete", output: [] })).toThrow(/status/i);
    expect(() => extractOpenAiResponseText({ status: "completed", output: [] })).toThrow(/empty/i);
  });

  it("accepts fenced provider JSON and validates the required arrays", () => {
    expect(validateSummary(parseJson(`\`\`\`json\n${JSON.stringify(validSummary)}\n\`\`\``))).toEqual(validSummary);
    expect(() => validateSummary({ ...validSummary, strengths: [] })).toThrow(/strengths/i);
    expect(() => validateSummary({ ...validSummary, nextSteps: [] })).toThrow(/nextSteps/i);
  });

  it("locks summary generation to exactly one configured provider", () => {
    expect(parseSummaryProvider(undefined)).toBe("deterministic");
    expect(parseSummaryProvider(" OPENAI ")).toBe("openai");
    expect(parseSummaryProvider("claude")).toBe("claude");
    expect(() => parseSummaryProvider("automatic")).toThrow(/TUTOR_PROVIDER/);
  });

  it("preserves deterministic score/completion and removes contradictory weaknesses", () => {
    const generated = {
      ...validSummary,
      overallScore: 99,
      completedAllPhases: true,
      strengths: ["Compared permanent-canine extraction with orthodontic retention"],
      weaknesses: [
        "Needs to compare permanent-canine extraction with orthodontic retention",
        "Clarify CBCT justification",
      ],
    };
    const reconciled = reconcileGeneratedSummary(generated, validSummary);

    expect(reconciled.overallScore).toBe(validSummary.overallScore);
    expect(reconciled.completedAllPhases).toBe(validSummary.completedAllPhases);
    expect(reconciled.weaknesses).toEqual(["Clarify CBCT justification"]);
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
