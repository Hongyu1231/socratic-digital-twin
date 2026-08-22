import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { TutorEvaluateInput, TutorEvaluationResult } from "@/lib/domain";
import { tutorOutputSchema } from "@/lib/schemas";
import { createOpenAIClient } from "@/lib/tutor/openai-client";
import { buildTutorInput, TUTOR_INSTRUCTIONS, TUTOR_PROMPT_VERSION } from "@/lib/tutor/prompt";

/**
 * Responses API tutor adapter.
 *
 * This adapter deliberately keeps all provider-specific work server-side. The
 * student's answer is serialized as quoted data in the user input and the
 * instructions explicitly tell the model never to treat that text as an
 * instruction. The state machine remains the sole authority for persistence,
 * phase advancement, and memory patch application.
 */
export class OpenAITutor {
  readonly mode = "openai" as const;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly instructions: string;
  private readonly promptVersion: string;

  constructor(apiKey: string, model: string, options?: { instructions?: string; promptVersion?: string }) {
    this.client = createOpenAIClient(apiKey);
    this.model = model;
    this.instructions = options?.instructions ?? TUTOR_INSTRUCTIONS;
    this.promptVersion = options?.promptVersion ?? TUTOR_PROMPT_VERSION;
  }

  async evaluate(input: TutorEvaluateInput): Promise<TutorEvaluationResult> {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      max_output_tokens: 900,
      instructions: this.instructions,
      input: buildTutorInput(input, this.promptVersion),
      text: { format: zodTextFormat(tutorOutputSchema, "tutor_evaluation") },
    });

    if (response.status !== "completed" || !response.output_parsed) {
      throw new Error(`OpenAI returned an unusable response status: ${response.status ?? "unknown"}`);
    }

    const parsed = tutorOutputSchema.safeParse(response.output_parsed);
    if (!parsed.success) {
      throw new Error("OpenAI returned output that does not match the tutor schema.");
    }

    // `responses.parse` validates the structured output with the same schema
    // used by the rest of the application. Do not apply any model-provided
    // state directly here; the state machine applies only the allow-listed
    // memoryPatch fields.
    return { ...parsed.data, source: "openai" };
  }
}
