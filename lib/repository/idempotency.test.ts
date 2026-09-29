import { beforeEach, describe, expect, it } from "vitest";
import type { Evaluation, TutorMessage } from "@/lib/domain";
import { resetRepositoryForTests } from "@/lib/repository";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { IdempotencyConflictError } from "@/lib/repository/types";
import { DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID } from "@/lib/seed";

describe("turn idempotency", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
  });

  function inputFor(started: Awaited<ReturnType<InMemoryTutorRepository["createSession"]>>, status: "active" | "completed" = "active") {
    const now = new Date().toISOString();
    const studentMessage: TutorMessage = {
      id: crypto.randomUUID(),
      sessionId: started.session.id,
      sender: "student",
      content: "The unerupted canine needs a focused assessment.",
      timestamp: now,
    };
    const evaluation: Evaluation = {
      id: crypto.randomUUID(),
      messageId: studentMessage.id,
      classification: "partial",
      confidence: 0.8,
      reasoningGap: "Connect the finding to the next investigation.",
      strategy: "probe",
      phaseComplete: false,
      feedback: "What would you investigate next?",
      createdAt: now,
    };
    const aiMessage: TutorMessage = {
      id: crypto.randomUUID(),
      sessionId: started.session.id,
      sender: "ai",
      content: "What would you investigate next?",
      timestamp: new Date(Date.now() + 1).toISOString(),
      replyToMessageId: studentMessage.id,
      acknowledgement: "You identified an important finding.",
      moveType: "question",
    };
    return {
      sessionId: started.session.id,
      expectedVersion: started.session.state.version,
      clientRequestId: "turn-retry-123",
      studentMessage,
      evaluation,
      aiMessage,
      nextState: { ...started.session.state, version: started.session.state.version + 1, updatedAt: now },
      nextPhase: started.session.currentPhase,
      status,
      score: status === "completed" ? 70 : null,
      summary: status === "completed" ? {
        overallScore: 70,
        headline: "Early learning summary",
        narrative: "One answer was submitted.",
        strengths: ["Identified relevant evidence"],
        weaknesses: ["Needs a clearer consequence"],
        nextSteps: ["Connect evidence to clinical impact"],
        completedAllPhases: false,
      } : null,
      completedAt: status === "completed" ? now : null,
    };
  }

  it("returns the original bundle when the final commit is retried after completion", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const input = inputFor(started, "completed");
    const first = await repository.commitTurn(input);
    const retry = await repository.commitTurn(input);

    expect(first.session.status).toBe("completed");
    expect(retry.session.status).toBe("completed");
    expect(retry.session.messages).toHaveLength(first.session.messages.length);
    expect(retry.session.messages.at(-1)).toMatchObject({ acknowledgement: "You identified an important finding.", moveType: "question" });
    expect(retry.session.evaluations).toHaveLength(1);
  });

  it("rejects reuse of a request key with different content", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const input = inputFor(started);
    await repository.commitTurn(input);

    await expect(repository.findCommittedTurn(started.session.id, DEMO_STUDENT_ID, input.clientRequestId!, input.studentMessage.content))
      .resolves.toMatchObject({ session: { id: started.session.id } });
    await expect(repository.findCommittedTurn(started.session.id, DEMO_STUDENT_ID, input.clientRequestId!, "Different answer"))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(repository.commitTurn({ ...input, studentMessage: { ...input.studentMessage, content: "Different answer" } }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("checks ownership before exposing a committed retry", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const input = inputFor(started);
    await repository.commitTurn(input);

    await expect(repository.findCommittedTurn(started.session.id, "not-the-student", input.clientRequestId!, input.studentMessage.content))
      .rejects.toThrow("belongs to another learner");
  });
});
