import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { TutorEvaluateInput, TutorEvaluationResult } from "@/lib/domain";
import { tutorOutputSchema } from "@/lib/schemas";
import { buildTutorInput, TUTOR_INSTRUCTIONS, TUTOR_PROMPT_VERSION } from "@/lib/tutor/prompt";
export class ClaudeTutor {
  readonly mode = "claude" as const;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly instructions: string;
  private readonly promptVersion: string;

  constructor(apiKey: string, model: string, options?: { instructions?: string; promptVersion?: string }) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
    this.model = model;
    this.instructions = options?.instructions ?? TUTOR_INSTRUCTIONS;
    this.promptVersion = options?.promptVersion ?? TUTOR_PROMPT_VERSION;
  }

  async evaluate(input: TutorEvaluateInput): Promise<TutorEvaluationResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 900,
      system: this.instructions,
      messages: [
        {
          role: "user",
          content: buildTutorInput(input, this.promptVersion),
        },
      ],
      output_config: { format: zodOutputFormat(tutorOutputSchema) },
    });

    if (response.stop_reason !== "end_turn" || !response.parsed_output) {
      throw new Error(`Claude returned an unusable stop reason: ${response.stop_reason}`);
    }
    return { ...response.parsed_output, source: "claude" };
  }
}
