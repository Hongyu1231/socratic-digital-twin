import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { Evaluation, LearnerState, SessionSummary } from "@/lib/domain";
import { summaryOutputSchema } from "@/lib/schemas";
import { createOpenAIClient } from "@/lib/tutor/openai-client";
import { buildSessionSummary } from "@/lib/tutor/summary";
import { getConfiguredTutorProvider, requireTutorProviderCredentials } from "@/lib/tutor/provider-config";
import { removeSummaryContradictions } from "@/lib/tutor/learner-model";

function reconcileGeneratedSummary(summary: SessionSummary, fallback: SessionSummary): SessionSummary {
  const reconciled = removeSummaryContradictions(summary.strengths, summary.weaknesses);
  return {
    ...summary,
    strengths: reconciled.strengths.length ? reconciled.strengths : fallback.strengths,
    weaknesses: reconciled.weaknesses.length ? reconciled.weaknesses : fallback.weaknesses,
  };
}

export async function generateSessionSummary(
  evaluations: Evaluation[],
  state: LearnerState,
  completedAllPhases: boolean,
): Promise<SessionSummary> {
  const fallback = buildSessionSummary(evaluations, state, completedAllPhases);
  const provider = getConfiguredTutorProvider();
  if (provider === "deterministic") return fallback;
  const { apiKey, model } = requireTutorProviderCredentials(provider);
  if (provider === "openai") {
    try {
      const client = createOpenAIClient(apiKey);
      const response = await client.responses.parse({
        model,
        store: false,
        max_output_tokens: 850,
        instructions: "Create concise formative feedback for a dentistry learner. Describe observable reasoning only. Do not add clinical facts, diagnoses, or hidden chain-of-thought.",
        input: JSON.stringify({
          score: fallback.overallScore,
          completedAllPhases,
          classifications: evaluations.map((item) => item.classification),
          recordedStrengths: state.strengths,
          recordedWeaknesses: state.weaknesses,
          previousErrors: state.previousErrors,
        }),
        text: { format: zodTextFormat(summaryOutputSchema, "session_summary") },
      });
      if (response.status === "completed" && response.output_parsed) {
        const parsed = summaryOutputSchema.safeParse(response.output_parsed);
        if (parsed.success) {
          return reconcileGeneratedSummary(
            { ...parsed.data, overallScore: fallback.overallScore, completedAllPhases },
            fallback,
          );
        }
        console.error("OpenAI summary fallback", { reason: "schema_validation" });
      } else {
        console.error("OpenAI summary fallback", { responseStatus: response.status ?? "unknown" });
      }
    } catch (error) {
      console.error("OpenAI summary fallback", { errorType: error instanceof Error ? error.name : "unknown" });
    }
    return fallback;
  }

  try {
    const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
    const response = await client.messages.parse({
      model,
      max_tokens: 850,
      system: "Create concise formative feedback for a dentistry learner. Describe observable reasoning only. Do not add clinical facts, diagnoses, or hidden chain-of-thought.",
      messages: [{ role: "user", content: JSON.stringify({
        score: fallback.overallScore,
        completedAllPhases,
        classifications: evaluations.map((item) => item.classification),
        recordedStrengths: state.strengths,
        recordedWeaknesses: state.weaknesses,
        previousErrors: state.previousErrors,
      }) }],
      output_config: { format: zodOutputFormat(summaryOutputSchema) },
    });
    if (response.stop_reason !== "end_turn" || !response.parsed_output) return fallback;
    return reconcileGeneratedSummary(
      { ...response.parsed_output, overallScore: fallback.overallScore, completedAllPhases },
      fallback,
    );
  } catch (error) {
    console.error("Claude summary fallback", { errorType: error instanceof Error ? error.name : "unknown" });
    return fallback;
  }
}
