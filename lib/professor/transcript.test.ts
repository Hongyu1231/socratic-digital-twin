import { describe, expect, it } from "vitest";
import type { Evaluation, TutorMessage } from "@/lib/domain";
import { projectProfessorTranscript } from "@/lib/professor/transcript";

function message(
  id: string,
  sender: TutorMessage["sender"],
  content: string,
  extra: Partial<TutorMessage> = {},
): TutorMessage {
  return {
    id,
    sessionId: "session-1",
    sender,
    content,
    timestamp: `2026-10-09T00:00:${id.replace(/\D/g, "").padStart(2, "0")}Z`,
    ...extra,
  };
}

function evaluation(
  id: string,
  messageId: string,
  extra: Partial<Evaluation> = {},
): Evaluation {
  return {
    id,
    messageId,
    classification: "correct",
    confidence: 0.9,
    reasoningGap: "None",
    strategy: "probe",
    phaseComplete: false,
    feedback: "Keep going.",
    createdAt: "2026-10-09T00:00:00Z",
    ...extra,
  };
}

describe("projectProfessorTranscript", () => {
  it("keeps Help before and between answers chronological, ungraded, and out of answer numbering", () => {
    const messages = [
      message("tutor-opening", "ai", "Start by locating the finding."),
      message("help-before", "student", "Requested more help", {
        turnKind: "help",
        helpRequested: true,
        phaseOrder: 1,
        supportLevel: 1,
      }),
      message("help-before-reply", "ai", "Here is a plan to critique.", {
        turnKind: "help",
        helpRequested: true,
        replyToMessageId: "help-before",
        phaseOrder: 1,
        supportLevel: 1,
      }),
      message("answer-1", "student", "The lesion is distal."),
      message("answer-1-reply", "ai", "What supports that location?"),
      message("help-between", "student", "Requested more help", {
        turnKind: "help",
        helpRequested: true,
        phaseOrder: 1,
        supportLevel: 2,
        completedWithSupport: true,
      }),
      message("help-between-reply", "ai", "The reveal is here; apply it.", {
        turnKind: "help",
        helpRequested: true,
        replyToMessageId: "help-between",
        phaseOrder: 1,
        supportLevel: 2,
        completedWithSupport: true,
      }),
      message("answer-2", "student", "I would compare the margins."),
      message("answer-2-reply", "ai", "Now explain the consequence."),
    ];

    const turns = projectProfessorTranscript({
      messages,
      evaluations: [evaluation("eval-1", "answer-1"), evaluation("eval-2", "answer-2")],
    });

    expect(turns.map((turn) => turn.kind)).toEqual(["context", "help", "answer", "help", "answer"]);
    expect(turns[1]).toMatchObject({
      kind: "help",
      id: "help-before",
      tutorReply: { id: "help-before-reply" },
      supportLevel: 1,
    });
    expect(turns[2]).toMatchObject({
      kind: "answer",
      id: "answer-1",
      answerNumber: 1,
      tutorReply: { id: "answer-1-reply" },
      evaluation: { id: "eval-1" },
    });
    expect(turns[3]).toMatchObject({
      kind: "help",
      id: "help-between",
      tutorReply: { id: "help-between-reply" },
      supportLevel: 2,
      completedWithSupport: true,
    });
    expect(turns[4]).toMatchObject({
      kind: "answer",
      id: "answer-2",
      answerNumber: 2,
      tutorReply: { id: "answer-2-reply" },
      evaluation: { id: "eval-2" },
    });
    expect(turns.find((turn) => turn.kind === "help" && turn.id === "help-between")).not.toHaveProperty("evaluation");
  });

  it("does not let an answer borrow a future Help reply", () => {
    const turns = projectProfessorTranscript({
      messages: [
        message("opening", "ai", "Opening question"),
        message("answer", "student", "First answer"),
        message("answer-reply", "ai", "Probe the evidence."),
        message("help", "student", "Requested more help", { turnKind: "help", helpRequested: true }),
        message("help-reply", "ai", "Critique this plan.", { turnKind: "help", helpRequested: true }),
      ],
      evaluations: [evaluation("evaluation", "answer")],
    });

    expect(turns).toHaveLength(3);
    expect(turns[1]).toMatchObject({ kind: "answer", tutorReply: { id: "answer-reply" } });
    expect(turns[2]).toMatchObject({ kind: "help", tutorReply: { id: "help-reply" } });
  });

  it("keeps final reflection in sequence without assigning it an answer number", () => {
    const turns = projectProfessorTranscript({
      messages: [
        message("opening", "ai", "Opening question"),
        message("answer", "student", "A reasoned answer"),
        message("answer-reply", "ai", "Good. Continue."),
        message("reflection", "student", "I learned to compare the findings."),
        message("reflection-reply", "ai", "Thank you for reflecting.", { moveType: "reflection" }),
      ],
      evaluations: [
        evaluation("answer-evaluation", "answer"),
        evaluation("reflection-evaluation", "reflection", { isReflection: true, strategy: "reflect" }),
      ],
    });

    expect(turns.map((turn) => turn.kind)).toEqual(["context", "answer", "reflection"]);
    expect(turns[1]).toMatchObject({ kind: "answer", answerNumber: 1 });
    expect(turns[2]).toMatchObject({
      kind: "reflection",
      answer: { id: "reflection" },
      tutorReply: { id: "reflection-reply" },
      evaluation: { id: "reflection-evaluation", isReflection: true },
    });
    expect(turns[2]).not.toHaveProperty("answerNumber");
  });

  it("recognizes a legacy reflection answer from the preceding reflection question when its evaluation is missing", () => {
    const turns = projectProfessorTranscript({
      messages: [
        message("opening", "ai", "Opening question"),
        message("answer", "student", "A reasoned answer"),
        message("reflection-question", "ai", "What would you revisit?", { moveType: "reflection" }),
        message("reflection", "student", "I would verify the assumption first."),
        message("reflection-reply", "ai", "Thank you for reflecting.", { moveType: "transition" }),
      ],
      evaluations: [evaluation("answer-evaluation", "answer")],
    });

    expect(turns.map((turn) => turn.kind)).toEqual(["context", "answer", "reflection"]);
    expect(turns[2]).toMatchObject({ kind: "reflection", id: "reflection" });
    expect(turns[2]).not.toHaveProperty("answerNumber");
    expect(turns[2]).not.toHaveProperty("evaluation");
  });

  it("shows opening tutor context for a session with no student answers", () => {
    const turns = projectProfessorTranscript({
      messages: [message("opening", "ai", "Welcome to the case.")],
      evaluations: [evaluation("orphan", "missing-student")],
    });

    expect(turns).toEqual([{ kind: "context", id: "opening", tutorMessage: expect.objectContaining({ content: "Welcome to the case." }) }]);
  });

  it("treats unknown legacy turns as answers and never infers Help from marker wording", () => {
    const turns = projectProfessorTranscript({
      messages: [
        message("opening", "ai", "Opening question"),
        message("legacy-answer", "student", "Requested more help"),
        message("legacy-reply", "ai", "What evidence supports that?"),
      ],
      evaluations: [evaluation("legacy-evaluation", "legacy-answer")],
    });

    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({
      kind: "answer",
      answerNumber: 1,
      id: "legacy-answer",
      tutorReply: { id: "legacy-reply" },
      evaluation: { id: "legacy-evaluation" },
    });
  });
});
