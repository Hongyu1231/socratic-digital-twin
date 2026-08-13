import type { TutorEvaluationResult } from "@/lib/domain";
import type { FrozenTutorSample, TutorCandidate } from "@/lib/experiments/types";
import { tutorOutputSchema } from "@/lib/schemas";
import { ClaudeTutor } from "@/lib/tutor/claude";
import { DeterministicTutor } from "@/lib/tutor/deterministic";
import { OpenAITutor } from "@/lib/tutor/openai";

function engineFor(candidate: TutorCandidate) {
  if (candidate.provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is required to evaluate this candidate.");
    return new OpenAITutor(key, candidate.model, {
      instructions: candidate.instructions,
      promptVersion: candidate.promptVersion,
    });
  }
  if (candidate.provider === "claude") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is required to evaluate this candidate.");
    return new ClaudeTutor(key, candidate.model, {
      instructions: candidate.instructions,
      promptVersion: candidate.promptVersion,
    });
  }
  return new DeterministicTutor();
}

export async function runCandidateOnSample(sample: FrozenTutorSample, candidate: TutorCandidate): Promise<TutorEvaluationResult> {
  const engine = engineFor(candidate);
  const result = await engine.evaluate({
    phase: {
      id: sample.sampleKey,
      caseId: sample.sampleKey,
      order: 1,
      title: sample.phase.title,
      goal: sample.phase.goal,
      rubric: sample.phase.rubric,
      starterQuestion: "What evidence supports your reasoning?",
      exampleQuestions: ["What evidence supports your reasoning?"],
    },
    answer: sample.answer,
    state: {
      sessionId: sample.sampleKey,
      currentGoal: sample.phase.goal,
      previousErrors: [], strengths: [], weaknesses: [], nextStrategy: "probe",
      phaseAttempts: { "1": Math.max(0, sample.attempt - 1) }, mastery: { "1": 0 }, version: 1,
      updatedAt: new Date(0).toISOString(),
    },
    attempt: sample.attempt,
  });
  const { source: _source, ...structuredOutput } = result;
  void _source;
  const valid = tutorOutputSchema.safeParse(structuredOutput);
  if (!valid.success) throw new Error("Candidate returned invalid structured output.");
  return result;
}
