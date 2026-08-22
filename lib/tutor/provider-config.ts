export type TutorProvider = "deterministic" | "openai" | "claude";

export function getConfiguredTutorProvider(): TutorProvider {
  const value = (process.env.TUTOR_PROVIDER ?? "deterministic").trim().toLowerCase();
  if (value === "deterministic" || value === "openai" || value === "claude") return value;
  throw new Error("TUTOR_PROVIDER must be deterministic, openai, or claude.");
}

export function requireTutorProviderCredentials(provider: Exclude<TutorProvider, "deterministic">) {
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
      throw new Error("TUTOR_PROVIDER=openai requires OPENAI_API_KEY and OPENAI_MODEL.");
    }
    return { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.CLAUDE_MODEL) {
    throw new Error("TUTOR_PROVIDER=claude requires ANTHROPIC_API_KEY and CLAUDE_MODEL.");
  }
  return { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.CLAUDE_MODEL };
}
