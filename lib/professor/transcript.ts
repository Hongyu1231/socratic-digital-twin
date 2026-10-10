import type { Evaluation, LearningSession, TutorMessage } from "@/lib/domain";

export interface ProfessorTranscriptContextTurn {
  kind: "context";
  id: string;
  tutorMessage: TutorMessage;
}

export interface ProfessorTranscriptAnswerTurn {
  kind: "answer";
  id: string;
  answer: TutorMessage;
  question?: TutorMessage;
  tutorReply?: TutorMessage;
  evaluation?: Evaluation;
  answerNumber: number;
}

export interface ProfessorTranscriptHelpTurn {
  kind: "help";
  id: string;
  marker: TutorMessage;
  question?: TutorMessage;
  tutorReply?: TutorMessage;
  phaseOrder?: number;
  supportLevel?: 0 | 1 | 2;
  completedWithSupport?: boolean;
}

export interface ProfessorTranscriptReflectionTurn {
  kind: "reflection";
  id: string;
  answer: TutorMessage;
  question?: TutorMessage;
  tutorReply?: TutorMessage;
  evaluation?: Evaluation;
}

export type ProfessorTranscriptTurn =
  | ProfessorTranscriptContextTurn
  | ProfessorTranscriptAnswerTurn
  | ProfessorTranscriptHelpTurn
  | ProfessorTranscriptReflectionTurn;

function isHelpMessage(message: TutorMessage) {
  // The discriminator is the source of truth. Never infer Help from the
  // server-generated marker text, since an ordinary answer may contain it.
  return message.turnKind === "help" || message.helpRequested === true;
}

function isReflectionMessage(message: TutorMessage, evaluation?: Evaluation, question?: TutorMessage) {
  // Current sessions mark the reflection answer with isReflection on its
  // evaluation. Legacy/staff payloads can omit that row, while retaining the
  // reflection move on the tutor question that immediately precedes it.
  return evaluation?.isReflection === true
    || message.moveType === "reflection"
    || question?.moveType === "reflection";
}

function firstTutorReply(messages: TutorMessage[], studentIndex: number, nextStudentIndex: number) {
  return messages.slice(studentIndex + 1, nextStudentIndex).find((message) => message.sender === "ai");
}

function previousTutorMessage(messages: TutorMessage[], studentIndex: number) {
  return messages.slice(0, studentIndex).toReversed().find((message) => message.sender === "ai");
}

/**
 * Project the staff transcript from the sequence-ordered message union.
 *
 * Evaluations are optional by design: accepted Help turns have none, and
 * legacy messages may predate the turn discriminator. Only a student message
 * with a matching evaluation receives evaluation data, so this function never
 * invents a phantom evaluation row.
 */
export function projectProfessorTranscript(
  input: Pick<LearningSession, "messages" | "evaluations">,
): ProfessorTranscriptTurn[] {
  const messages = input.messages;
  const evaluationByMessageId = new Map(input.evaluations.map((evaluation) => [evaluation.messageId, evaluation]));
  const studentIndexes = messages.flatMap((message, index) => message.sender === "student" ? [index] : []);
  const firstStudentIndex = studentIndexes[0] ?? messages.length;
  const turns: ProfessorTranscriptTurn[] = messages
    .slice(0, firstStudentIndex)
    .filter((message) => message.sender === "ai")
    .map((message) => ({ kind: "context" as const, id: message.id, tutorMessage: message }));

  let answerNumber = 0;
  for (const [studentPosition, studentIndex] of studentIndexes.entries()) {
    const answer = messages[studentIndex];
    if (!answer) continue;

    const nextStudentIndex = studentIndexes[studentPosition + 1] ?? messages.length;
    const tutorReply = firstTutorReply(messages, studentIndex, nextStudentIndex);
    const question = previousTutorMessage(messages, studentIndex);
    const evaluation = evaluationByMessageId.get(answer.id);

    if (isHelpMessage(answer)) {
      // A Help turn is deliberately ungraded even if malformed/legacy input
      // happens to contain an evaluation with the same message id.
      turns.push({
        kind: "help",
        id: answer.id,
        marker: answer,
        question,
        tutorReply,
        phaseOrder: answer.phaseOrder ?? tutorReply?.phaseOrder,
        supportLevel: answer.supportLevel ?? tutorReply?.supportLevel,
        completedWithSupport: answer.completedWithSupport ?? tutorReply?.completedWithSupport,
      });
      continue;
    }

    if (isReflectionMessage(answer, evaluation, question)) {
      turns.push({ kind: "reflection", id: answer.id, answer, question, tutorReply, ...(evaluation ? { evaluation } : {}) });
      continue;
    }

    answerNumber += 1;
    turns.push({ kind: "answer", id: answer.id, answer, question, tutorReply, answerNumber, ...(evaluation ? { evaluation } : {}) });
  }

  return turns;
}
