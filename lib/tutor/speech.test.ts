import { beforeEach, describe, expect, it, vi } from "vitest";

const createSpeechMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    audio = { speech: { create: createSpeechMock } };
  },
}));

import {
  DEFAULT_TTS_VOICE,
  OpenAITutorSpeech,
  resolveTutorSpeechVoice,
} from "@/lib/tutor/speech";

describe("OpenAI tutor speech", () => {
  beforeEach(() => createSpeechMock.mockReset());

  it("generates an MP3 with a warm tutor speaking style", async () => {
    const expected = new Uint8Array([1, 2, 3]).buffer;
    createSpeechMock.mockResolvedValue({ arrayBuffer: vi.fn().mockResolvedValue(expected) });
    const speech = new OpenAITutorSpeech("test-key", "gpt-4o-mini-tts", "marin");

    await expect(speech.synthesize("What evidence supports that concern?")).resolves.toBe(expected);
    expect(createSpeechMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      response_format: "mp3",
      input: "What evidence supports that concern?",
      instructions: expect.stringContaining("warm, calm university clinical tutor"),
    }));
  });

  it("rejects empty and oversized input before calling the provider", async () => {
    const speech = new OpenAITutorSpeech("test-key");
    await expect(speech.synthesize("   ")).rejects.toThrow("between 1 and 4096");
    await expect(speech.synthesize("x".repeat(4_097))).rejects.toThrow("between 1 and 4096");
    expect(createSpeechMock).not.toHaveBeenCalled();
  });

  it("uses the safe default for an unsupported configured voice", () => {
    expect(resolveTutorSpeechVoice("cedar")).toBe("cedar");
    expect(resolveTutorSpeechVoice("unknown-voice")).toBe(DEFAULT_TTS_VOICE);
  });
});
