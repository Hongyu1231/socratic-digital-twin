export type Summary = {
  overallScore: number;
  headline: string;
  narrative: string;
  strengths: string[];
  weaknesses: string[];
  nextSteps: string[];
  completedAllPhases: boolean;
};

export const SUMMARY_INSTRUCTIONS =
  "Create concise formative feedback for a dentistry learner. Describe observable reasoning only. Do not add clinical facts, diagnoses, or hidden chain-of-thought. Return the requested structured summary.";

export type SummaryProvider = "deterministic" | "openai" | "claude";

export function parseSummaryProvider(value: string | null | undefined): SummaryProvider {
  const provider = (value ?? "deterministic").trim().toLowerCase();
  if (provider === "deterministic" || provider === "openai" || provider === "claude") return provider;
  throw new Error("TUTOR_PROVIDER must be deterministic, openai, or claude");
}

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: {
    overallScore: { type: "number", minimum: 0, maximum: 100 },
    headline: { type: "string" },
    narrative: { type: "string" },
    strengths: { type: "array", minItems: 1, items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", minItems: 1, items: { type: "string" } },
    completedAllPhases: { type: "boolean" },
  },
  required: [
    "overallScore",
    "headline",
    "narrative",
    "strengths",
    "weaknesses",
    "nextSteps",
    "completedAllPhases",
  ],
  additionalProperties: false,
} as const;

export function buildOpenAiResponsesBody(payload: unknown, model: string) {
  return {
    model,
    store: false,
    max_output_tokens: 1_200,
    instructions: SUMMARY_INSTRUCTIONS,
    input: JSON.stringify(payload),
    text: {
      format: {
        type: "json_schema",
        name: "session_summary",
        strict: true,
        schema: SUMMARY_JSON_SCHEMA,
      },
    },
  };
}

export function extractOpenAiResponseText(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("OpenAI returned an invalid response");
  const response = value as Record<string, unknown>;
  if (response.status !== "completed") {
    throw new Error(`OpenAI returned an unusable response status: ${String(response.status ?? "unknown")}`);
  }

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  if (Array.isArray(response.output)) {
    for (const output of response.output) {
      if (!output || typeof output !== "object") continue;
      const content = (output as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (record.type === "output_text" && typeof record.text === "string" && record.text.trim()) {
          return record.text;
        }
      }
    }
  }

  throw new Error("OpenAI returned an empty summary");
}

export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Summary provider did not return JSON");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown, required: boolean): string[] | null {
  if (!Array.isArray(value)) return null;
  const result = value
    .map((item) => nonEmptyString(item))
    .filter((item): item is string => item !== null);
  return required && result.length === 0 ? null : result;
}

export function validateSummary(value: unknown): Summary {
  if (!value || typeof value !== "object") throw new Error("Summary is not an object");
  const record = value as Record<string, unknown>;
  const overallScore = record.overallScore;
  const headline = nonEmptyString(record.headline);
  const narrative = nonEmptyString(record.narrative);
  const strengths = stringArray(record.strengths, true);
  const weaknesses = stringArray(record.weaknesses, false);
  const nextSteps = stringArray(record.nextSteps, true);

  if (
    typeof overallScore !== "number" ||
    !Number.isFinite(overallScore) ||
    overallScore < 0 ||
    overallScore > 100 ||
    !headline ||
    !narrative ||
    !strengths ||
    !weaknesses ||
    !nextSteps ||
    typeof record.completedAllPhases !== "boolean"
  ) {
    throw new Error("Summary failed schema validation (strengths and nextSteps cannot be empty)");
  }

  return {
    overallScore,
    headline,
    narrative,
    strengths,
    weaknesses,
    nextSteps,
    completedAllPhases: record.completedAllPhases,
  };
}

const SUMMARY_STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "compared", "compare", "did", "does", "for", "from",
  "has", "have", "identified", "in", "is", "it", "need", "needed", "needs", "of", "on", "should",
  "the", "their", "to", "was", "with", "would", "phase", "reasoning",
]);

function conceptTokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
    .filter((token) => token.length > 2 && !SUMMARY_STOP_WORDS.has(token)));
}

function describesSameConcept(left: string, right: string) {
  const a = conceptTokens(left);
  const b = conceptTokens(right);
  if (!a.size || !b.size) return false;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap >= 2 && overlap / Math.min(a.size, b.size) >= 0.6;
}

export function reconcileGeneratedSummary(generated: Summary, fallback: Summary): Summary {
  const strengths = [...new Set(generated.strengths.map((item) => item.trim()).filter(Boolean))].slice(0, 5);
  const weaknesses = [...new Set(generated.weaknesses.map((item) => item.trim()).filter(Boolean))]
    .filter((weakness) => !strengths.some((strength) => describesSameConcept(strength, weakness)))
    .slice(0, 5);
  return {
    ...generated,
    overallScore: fallback.overallScore,
    completedAllPhases: fallback.completedAllPhases,
    strengths: strengths.length ? strengths : fallback.strengths,
    weaknesses,
  };
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Summary provider timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const responseText = await response.text();
    let body: unknown = null;
    try {
      body = responseText ? JSON.parse(responseText) : null;
    } catch {
      body = responseText;
    }
    if (!response.ok) {
      // Provider bodies can echo request details, so only the status is safe
      // for job telemetry.
      throw new Error(`Summary provider returned HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}
