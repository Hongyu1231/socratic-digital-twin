import { beforeEach, describe, expect, it } from "vitest";
import type { Evaluation, TutorMessage } from "@/lib/domain";
import { resetRepositoryForTests } from "@/lib/repository";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { IdempotencyConflictError } from "@/lib/repository/types";
import { DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID } from "@/lib/seed";

type PersistedTutorMessage = TutorMessage & {
  turnKind?: "answer" | "help";
  helpRequested?: boolean;
  phaseOrder?: number;
  supportLevel?: 0 | 1 | 2;
  completedWithSupport?: boolean;
};

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

  it("commits and replays a Help pair without an evaluation", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const now = new Date().toISOString();
    const marker = {
      id: crypto.randomUUID(),
      sessionId: started.session.id,
      sender: "student" as const,
      content: "Requested more help",
      timestamp: now,
      turnKind: "help" as const,
      helpRequested: true,
      phaseOrder: 1,
      supportLevel: 1 as const,
      completedWithSupport: false,
    } satisfies PersistedTutorMessage;
    const reply = {
      id: crypto.randomUUID(),
      sessionId: started.session.id,
      sender: "ai" as const,
      content: "Here is a plan to critique. What evidence would change your view?",
      timestamp: new Date(Date.now() + 1).toISOString(),
      replyToMessageId: marker.id,
      moveType: "hypothetical" as const,
      turnKind: "help" as const,
      helpRequested: true,
      phaseOrder: 1,
      supportLevel: 1 as const,
      completedWithSupport: false,
    } satisfies PersistedTutorMessage;
    const input = {
      sessionId: started.session.id,
      expectedVersion: started.session.state.version,
      clientRequestId: "help-retry-1",
      studentMessage: marker,
      evaluation: null,
      aiMessage: reply,
      nextState: {
        ...started.session.state,
        version: started.session.state.version + 1,
        updatedAt: now,
        phaseProgress: {
          ...started.session.state.phaseProgress,
          "1": {
            criteriaMet: [],
            bestClassification: "wrong" as const,
            noProgressCount: 0,
            supportLevel: 1 as const,
            awaitingApplication: false,
            completedWithSupport: false,
            completed: false,
          },
        },
      },
      nextPhase: started.session.currentPhase,
      status: "active" as const,
      score: null,
      summary: null,
      completedAt: null,
    };

    await expect(repository.commitTurn({ ...input, clientRequestId: undefined }))
      .rejects.toThrow("Help turns require a client request ID.");
    const invalidPhaseInput = {
      ...input,
      clientRequestId: "help-invalid-phase",
      nextPhase: input.nextPhase + 1,
    };
    await expect(repository.commitTurn(invalidPhaseInput))
      .rejects.toThrow("Help turns cannot advance the session phase.");
    const afterInvalidPhase = await repository.getSession(started.session.id);
    expect(afterInvalidPhase?.session.messages).toHaveLength(started.session.messages.length);
    expect(afterInvalidPhase?.session.evaluations).toHaveLength(0);
    expect(afterInvalidPhase?.session.currentPhase).toBe(started.session.currentPhase);
    expect(afterInvalidPhase?.session.state.version).toBe(started.session.state.version);

    const first = await repository.commitTurn(input);
    const replay = await repository.commitTurn(input);
    expect(first.session.messages).toHaveLength(started.session.messages.length + 2);
    expect(first.session.evaluations).toHaveLength(0);
    expect(first.session.state.version).toBe(started.session.state.version + 1);
    expect(first.session.messages.at(-2)).toMatchObject({
      content: "Requested more help",
      turnKind: "help",
      helpRequested: true,
      supportLevel: 1,
    });
    expect(first.session.messages.at(-1)).toMatchObject({
      turnKind: "help",
      helpRequested: true,
      replyToMessageId: marker.id,
      supportLevel: 1,
    });
    expect(replay.session.messages).toHaveLength(first.session.messages.length);
    expect(replay.session.evaluations).toHaveLength(0);

    const advancingAnswer = inputFor(first, "active");
    advancingAnswer.nextPhase = first.session.currentPhase + 1;
    const advanced = await repository.commitTurn(advancingAnswer);
    const lateReplay = await repository.commitTurn(input);
    expect(advanced.session.currentPhase).toBe(first.session.currentPhase + 1);
    expect(lateReplay.session.currentPhase).toBe(advanced.session.currentPhase);
    expect(lateReplay.session.messages).toHaveLength(advanced.session.messages.length);
    expect(lateReplay.session.evaluations).toHaveLength(1);
  });

  it("serializes concurrent duplicate Help requests as one support step", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const now = new Date().toISOString();
    const marker = {
      id: crypto.randomUUID(), sessionId: started.session.id, sender: "student" as const,
      content: "Requested more help", timestamp: now, turnKind: "help" as const,
      helpRequested: true, phaseOrder: 1, supportLevel: 1 as const, completedWithSupport: false,
    } satisfies PersistedTutorMessage;
    const reply = {
      id: crypto.randomUUID(), sessionId: started.session.id, sender: "ai" as const,
      content: "What evidence would change your view?", timestamp: now,
      replyToMessageId: marker.id, moveType: "hypothetical" as const, turnKind: "help" as const,
      helpRequested: true, phaseOrder: 1, supportLevel: 1 as const, completedWithSupport: false,
    } satisfies PersistedTutorMessage;
    const input = {
      sessionId: started.session.id, expectedVersion: started.session.state.version,
      clientRequestId: "help-concurrent-1", studentMessage: marker, evaluation: null, aiMessage: reply,
      nextState: { ...started.session.state, version: started.session.state.version + 1, updatedAt: now },
      nextPhase: started.session.currentPhase, status: "active" as const, score: null, summary: null, completedAt: null,
    };
    const [first, second] = await Promise.all([repository.commitTurn(input), repository.commitTurn(input)]);
    expect(first.session.messages).toHaveLength(started.session.messages.length + 2);
    expect(second.session.messages).toHaveLength(started.session.messages.length + 2);
    expect(first.session.evaluations).toHaveLength(0);
    expect(second.session.evaluations).toHaveLength(0);
    expect(first.session.state.version).toBe(started.session.state.version + 1);
    expect(second.session.state.version).toBe(started.session.state.version + 1);
  });

  it("rejects reuse of a request key across answer and Help operations", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const answer = inputFor(started);
    await repository.commitTurn(answer);
    const helpMarker = {
      ...answer.studentMessage,
      id: crypto.randomUUID(),
      content: "Requested more help",
      turnKind: "help" as const,
      helpRequested: true,
    } as PersistedTutorMessage;
    const helpReply = {
      ...answer.aiMessage,
      id: crypto.randomUUID(),
      content: "What evidence would change your view?",
      replyToMessageId: helpMarker.id,
      turnKind: "help" as const,
      helpRequested: true,
    } as PersistedTutorMessage;
    await expect(repository.commitTurn({
      ...answer,
      studentMessage: helpMarker,
      aiMessage: helpReply,
      evaluation: null,
      expectedVersion: answer.nextState.version,
      nextState: { ...answer.nextState, version: answer.nextState.version + 1 },
    })).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(repository.findCommittedTurn(
      started.session.id,
      DEMO_STUDENT_ID,
      answer.clientRequestId!,
      answer.studentMessage.content,
      "help",
    )).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
