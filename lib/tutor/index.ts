import { ClaudeTutor } from "@/lib/tutor/claude";
import { DeterministicTutor } from "@/lib/tutor/deterministic";
import { OpenAITutor } from "@/lib/tutor/openai";
import { getConfiguredTutorProvider, requireTutorProviderCredentials } from "@/lib/tutor/provider-config";

export type TutorEngine = OpenAITutor | ClaudeTutor | DeterministicTutor;

let singleton: TutorEngine | undefined;

export function getTutorEngine(): TutorEngine {
  if (singleton) return singleton;
  const provider = getConfiguredTutorProvider();
  if (provider === "openai") {
    const { apiKey, model } = requireTutorProviderCredentials(provider);
    singleton = new OpenAITutor(apiKey, model);
  } else if (provider === "claude") {
    const { apiKey, model } = requireTutorProviderCredentials(provider);
    singleton = new ClaudeTutor(apiKey, model);
  } else {
    singleton = new DeterministicTutor();
  }
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
    if (engine.mode === "deterministic") throw error;
    const fallback = await new DeterministicTutor().evaluate(input);
    return { ...fallback, fallbackFrom: engine.mode };
  }
}

export function getTutorMode() {
  return getTutorEngine().mode;
}
