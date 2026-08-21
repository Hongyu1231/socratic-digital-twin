export type Summary = {
  overallScore: number;
  headline: string;
  narrative: string;
  strengths: string[];
  weaknesses: string[];
  nextSteps: string[];
  completedAllPhases: boolean;
};

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
