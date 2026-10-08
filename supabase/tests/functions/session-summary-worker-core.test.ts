import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildOpenAiResponsesBody,
  extractOpenAiResponseText,
  fetchJson,
  OPENAI_RESPONSES_URL,
  parseJson,
  parseSummaryProvider,
  reconcileGeneratedSummary,
  SUMMARY_INSTRUCTIONS,
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
  it("asks for plain wording that never echoes internal text", () => {
    expect(SUMMARY_INSTRUCTIONS).toContain("plain words and short sentences");
    expect(SUMMARY_INSTRUCTIONS).toContain("Never copy a phase goal, criterion, rubric or any other internal wording");
  });

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

  it("bounds supported phase metadata while preserving valid phase numbers", () => {
    expect(validateSummary({
      ...validSummary,
      supportedPhases: [1, 3, 0, 13, 2.5, "2"],
    }).supportedPhases).toEqual([1, 3]);
    expect(validateSummary({ ...validSummary, supportedPhases: [] }).supportedPhases).toEqual([]);
    expect(validateSummary(validSummary).supportedPhases).toBeUndefined();
  });

  it("locks summary generation to exactly one configured provider", () => {
    expect(parseSummaryProvider(undefined)).toBe("deterministic");
    expect(parseSummaryProvider(" OPENAI ")).toBe("openai");
    expect(parseSummaryProvider("claude")).toBe("claude");
    expect(() => parseSummaryProvider("automatic")).toThrow(/TUTOR_PROVIDER/);
  });

  it("keeps deterministic evidence authoritative while accepting generated wording", () => {
    const fallback = {
      ...validSummary,
      headline: "Deterministic evidence summary",
      narrative: "The learner connected evidence to a proportionate next step.",
      weaknesses: ["Explain why first-line imaging comes before CBCT"],
    };
    const generated = {
      ...validSummary,
      overallScore: 99,
      headline: "Polished evidence-led reasoning",
      narrative: "A clearer generated account of the learner's reasoning.",
      completedAllPhases: true,
      strengths: ["Unsupported generated strength"],
      weaknesses: [
        "Needs to clarify CBCT justification",
        "New unsupported reasoning gap",
      ],
      nextSteps: ["Generated next step that differs from the evidence"],
    };
    const reconciled = reconcileGeneratedSummary(generated, fallback);

    expect(reconciled).toMatchObject({
      overallScore: fallback.overallScore,
      headline: generated.headline,
      narrative: generated.narrative,
      completedAllPhases: fallback.completedAllPhases,
      strengths: fallback.strengths,
      weaknesses: fallback.weaknesses,
      nextSteps: fallback.nextSteps,
    });
    expect(reconciled.strengths).not.toBe(fallback.strengths);
    expect(reconciled.weaknesses).not.toBe(fallback.weaknesses);
    expect(reconciled.nextSteps).not.toBe(fallback.nextSteps);
  });

  it("preserves supported-phase metadata and the deterministic caveat when AI claims unqualified mastery", () => {
    const fallback = {
      ...validSummary,
      completedAllPhases: true,
      supportedPhases: [1, 3],
      narrative: "Phases 1 and 3 were completed with tutor support, not demonstrated independent mastery.",
    };
    const generated = {
      ...validSummary,
      completedAllPhases: true,
      supportedPhases: [],
      narrative: "The learner independently mastered every phase and demonstrated complete mastery.",
    };

    const reconciled = reconcileGeneratedSummary(generated, fallback);
    expect(reconciled.supportedPhases).toEqual([1, 3]);
    expect(reconciled.narrative).toBe(fallback.narrative);
    expect(reconciled.narrative).not.toContain("independently mastered");
    expect(reconciled.completedAllPhases).toBe(fallback.completedAllPhases);
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
