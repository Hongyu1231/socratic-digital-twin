import type OpenAI from "openai";
import { z } from "zod";
import { createOpenAIClient } from "@/lib/tutor/openai-client";

export const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
export const DEFAULT_TTS_VOICE = "marin";

const speechVoiceSchema = z.enum([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);

export type TutorSpeechVoice = z.infer<typeof speechVoiceSchema>;

export function resolveTutorSpeechVoice(value: string | undefined): TutorSpeechVoice {
  const parsed = speechVoiceSchema.safeParse(value?.trim().toLowerCase());
  return parsed.success ? parsed.data : DEFAULT_TTS_VOICE;
}

export class OpenAITutorSpeech {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = DEFAULT_TTS_MODEL,
    private readonly voice: TutorSpeechVoice = DEFAULT_TTS_VOICE,
  ) {
    this.client = createOpenAIClient(apiKey);
  }

  async synthesize(text: string): Promise<ArrayBuffer> {
    const input = text.trim();
    if (!input || input.length > 4_096) {
      throw new Error("Tutor speech input must contain between 1 and 4096 characters.");
    }

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice,
      input,
      instructions: "Speak as a warm, calm university clinical tutor. Use natural pacing, clear English, and a thoughtful conversational tone. Do not sound theatrical or rushed.",
      response_format: "mp3",
      speed: 0.96,
    });

    return response.arrayBuffer();
  }
}
