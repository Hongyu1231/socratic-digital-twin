import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { CasePhase, LearnerState, TutorEvaluationResult } from "@/lib/domain";
import { tutorOutputSchema } from "@/lib/schemas";
import { buildTutorInput, TUTOR_INSTRUCTIONS } from "@/lib/tutor/prompt";

interface EvaluateInput {
  phase: CasePhase;
  answer: string;
  state: LearnerState;
  attempt: number;
}

export class ClaudeTutor {
  readonly mode = "claude" as const;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
    this.model = model;
  }

  async evaluate({ phase, answer, state, attempt }: EvaluateInput): Promise<TutorEvaluationResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 900,
      system: TUTOR_INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: buildTutorInput({ phase, answer, state, attempt }),
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
