import { describe, expect, it } from "vitest";
import type { Evaluation, TutorMessage } from "@/lib/domain";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { DEMO_ASSIGNMENT_ID, DEMO_PROFESSOR_ID, DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";

describe("repository review scoring", () => {
  it("does not save or score reflection evaluations as professor answer labels", async () => {
    const repository = new InMemoryTutorRepository();
    repository.reset();
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const store = (repository as unknown as { store: { sessions: Map<string, any>; answerReviews: Map<string, any> } }).store;
    const session = store.sessions.get(started.session.id);
    const now = new Date().toISOString();
    const gradedMessage: TutorMessage = {
      id: crypto.randomUUID(), sessionId: started.session.id, sender: "student", content: "The canine is unerupted.", timestamp: now,
    };
    const reflectionMessage: TutorMessage = {
      id: crypto.randomUUID(), sessionId: started.session.id, sender: "student", content: "I would revisit the evidence.", timestamp: now,
    };
    const graded: Evaluation = {
      id: crypto.randomUUID(), messageId: gradedMessage.id, classification: "correct", confidence: 0.95,
      reasoningGap: "", strategy: "probe", phaseComplete: false, feedback: "Good.", createdAt: now,
    };
    const reflection: Evaluation = {
      id: crypto.randomUUID(), messageId: reflectionMessage.id, classification: "wrong", confidence: 0.95,
      reasoningGap: "", strategy: "reflect", phaseComplete: false, feedback: "Reflect.", isReflection: true, createdAt: now,
    };
    session.messages.push(gradedMessage, reflectionMessage);
    session.evaluations = [graded, reflection];
    session.status = "completed";
    session.completedAt = now;
    store.sessions.set(session.id, session);

    const reviewed = await repository.saveReview({
      sessionId: session.id,
      professorId: DEMO_PROFESSOR_ID,
      reviews: [
        { evaluationId: graded.id, label: "correct", comments: "Clear." },
        { evaluationId: reflection.id, label: "wrong", comments: "Not a graded answer." },
      ],
      overallFeedback: "Good reasoning.",
      status: "completed",
    });

    expect(reviewed.sessionReview).toMatchObject({ finalScore: 100 });
    expect(store.answerReviews.has(graded.id)).toBe(true);
    expect(store.answerReviews.has(reflection.id)).toBe(false);
  });
});
