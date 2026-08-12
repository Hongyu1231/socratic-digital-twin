import { ClaudeTutor } from "@/lib/tutor/claude";
import { DeterministicTutor } from "@/lib/tutor/deterministic";
import { OpenAITutor } from "@/lib/tutor/openai";

export type TutorEngine = OpenAITutor | ClaudeTutor | DeterministicTutor;

let singleton: TutorEngine | undefined;

export function getTutorEngine(): TutorEngine {
  if (singleton) return singleton;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiModel = process.env.OPENAI_MODEL;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MODEL;
  singleton = openaiApiKey && openaiModel
    ? new OpenAITutor(openaiApiKey, openaiModel)
    : apiKey && model
      ? new ClaudeTutor(apiKey, model)
      : new DeterministicTutor();
  return singleton;
}

export async function evaluateWithFallback(
  input: Parameters<TutorEngine["evaluate"]>[0],
) {
  const engine = getTutorEngine();
  try {
    return await engine.evaluate(input);
  } catch (error) {
    const requestId = (() => {
      if (!error || typeof error !== "object") return "unavailable";
      const candidate = error as { _request_id?: unknown; request_id?: unknown };
      const value = candidate._request_id ?? candidate.request_id;
      return value ? String(value) : "unavailable";
    })();
    console.error("Tutor fallback", {
      provider: engine.mode,
      requestId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return new DeterministicTutor().evaluate(input);
  }
}

export function getTutorMode() {
  return getTutorEngine().mode;
}
