import { afterEach, describe, expect, it, vi } from "vitest";

import { getConfiguredTutorProvider, requireTutorProviderCredentials } from "@/lib/tutor/provider-config";

afterEach(() => vi.unstubAllEnvs());

describe("Tutor provider configuration", () => {
  it("defaults to deterministic even when live-provider credentials are present", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_MODEL", "test-openai-model");

    expect(getConfiguredTutorProvider()).toBe("deterministic");
  });

  it("accepts only an explicit supported provider", () => {
    vi.stubEnv("TUTOR_PROVIDER", " CLAUDE ");
    expect(getConfiguredTutorProvider()).toBe("claude");

    vi.stubEnv("TUTOR_PROVIDER", "automatic");
    expect(() => getConfiguredTutorProvider()).toThrow(/deterministic, openai, or claude/);
  });

  it("requires credentials only for the selected live provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-claude-key");
    vi.stubEnv("CLAUDE_MODEL", "test-claude-model");
    expect(requireTutorProviderCredentials("claude")).toEqual({
      apiKey: "test-claude-key",
      model: "test-claude-model",
    });
    expect(() => requireTutorProviderCredentials("openai")).toThrow(/OPENAI_API_KEY and OPENAI_MODEL/);
  });
});
