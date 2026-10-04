import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { TutorEvaluateInput, TutorEvaluationResult } from "@/lib/domain";
import { tutorProviderOutputSchema } from "@/lib/schemas";
import { normalizeCriterionTags } from "@/lib/tutor/criteria";
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
      // The cap includes reasoning/formatting tokens, not just visible JSON.
      // Leave room for a multi-criterion evaluation without unbounded retries.
      max_output_tokens: 2400,
      instructions: this.instructions,
      input: buildTutorInput(input, this.promptVersion),
      text: { format: zodTextFormat(tutorProviderOutputSchema, "tutor_evaluation") },
    }, { timeout: 25_000, maxRetries: 0 });

    if (response.status !== "completed" || !response.output_parsed) {
      const detail = response.incomplete_details?.reason;
      const reason = response.status === "incomplete" && (detail === "max_output_tokens" || detail === "content_filter") ? detail : null;
      throw new Error(`OpenAI returned an unusable response status: ${response.status ?? "unknown"}${reason ? ` (${reason})` : ""}`);
    }

    const parsed = tutorProviderOutputSchema.safeParse(response.output_parsed);
    if (!parsed.success) {
      throw new Error("OpenAI returned output that does not match the tutor schema.");
    }

    // `responses.parse` validates the structured output with the same schema
    // used by the rest of the application. Do not apply any model-provided
    // state directly here; the state machine applies only the allow-listed
    // memoryPatch fields.
    return normalizeCriterionTags({ ...parsed.data, acknowledgement: parsed.data.acknowledgement ?? undefined, source: "openai" }, input.phase);
  }
}
