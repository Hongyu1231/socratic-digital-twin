import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { CasePhase, LearnerState, TutorEvaluationResult } from "@/lib/domain";
import { tutorOutputSchema } from "@/lib/schemas";
import { createOpenAIClient } from "@/lib/tutor/openai-client";
import { buildTutorInput, TUTOR_INSTRUCTIONS } from "@/lib/tutor/prompt";

interface EvaluateInput {
  phase: CasePhase;
  answer: string;
  state: LearnerState;
  attempt: number;
}

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

  constructor(apiKey: string, model: string) {
    this.client = createOpenAIClient(apiKey);
    this.model = model;
  }

  async evaluate({ phase, answer, state, attempt }: EvaluateInput): Promise<TutorEvaluationResult> {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      max_output_tokens: 900,
      instructions: TUTOR_INSTRUCTIONS,
      input: buildTutorInput({ phase, answer, state, attempt }),
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
