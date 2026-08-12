import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { resetRepositoryForTests } from "@/lib/repository";
import { DEMO_PROFESSOR_ID, DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";
import { finishSession, submitStudentAnswer } from "@/lib/tutor/state-machine";

describe("Socratic state machine", () => {
  let repository: InMemoryTutorRepository;
  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
  });
  it("advances on a well-supported answer and remembers a strength", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const updated = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The unerupted canine and eruption asymmetry matter because this age and timing make an impaction more likely than normal variation.");
    expect(updated.session.currentPhase).toBe(2);
    expect(updated.session.state.strengths.length).toBe(1);
    expect(updated.session.messages).toHaveLength(3);
  });
  it("moves on after three unresolved attempts without losing the gap", async () => {
    let bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    for (const answer of ["I am unsure.", "Maybe something is wrong.", "I still do not know."]) {
      bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    }
    expect(bundle.session.currentPhase).toBe(2);
    expect(bundle.session.state.phaseAttempts["1"]).toBe(3);
  });
  it("returns the same committed turn for a duplicate request id", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const requestId = "duplicate-request-123";
    const first = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The canine is unerupted and could represent delayed eruption.", requestId);
    const second = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The canine is unerupted and could represent delayed eruption.", requestId);
    expect(second.session.messages).toHaveLength(first.session.messages.length);
  });
  it("creates a formative partial summary when ended early", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const completed = await finishSession(started.session.id, DEMO_STUDENT_ID);
    expect(completed.session.status).toBe("completed");
    expect(completed.session.summary?.completedAllPhases).toBe(false);
  });
  it("completes all five phases and generates a full summary", async () => {
    let bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const answers = [
      "The unerupted canine and eruption asymmetry matter because age and eruption timing make an impaction clinically significant rather than normal variation.",
      "I would begin with clinical palpation, then use a panoramic radiograph and parallax to determine position before justifying CBCT for unresolved anatomy.",
      "Root resorption of the adjacent incisor, available space, angulation, patient age and overall prognosis would change the urgency of treatment.",
      "Options include interceptive extraction, creating orthodontic space, surgical exposure with traction, or monitoring when the risk profile supports observation.",
      "The evidence should expose uncertainty and my main assumption; I would compare an alternative and reassess if new findings challenged the decision.",
    ];
    for (const answer of answers) bundle = await submitStudentAnswer(bundle.session.id, DEMO_STUDENT_ID, answer);
    expect(bundle.session.status).toBe("completed");
    expect(bundle.session.summary?.completedAllPhases).toBe(true);
    expect(bundle.session.evaluations).toHaveLength(5);
  });
  it("saves professor labels and a final review score", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    const answered = await submitStudentAnswer(started.session.id, DEMO_STUDENT_ID, "The unerupted canine is delayed and eruption timing at this age is asymmetric, which could indicate an impaction.");
    const reviewed = await repository.saveReview({
      sessionId: answered.session.id, professorId: DEMO_PROFESSOR_ID,
      reviews: [{ evaluationId: answered.session.evaluations[0].id, label: "partial", comments: "Needs a clearer consequence." }],
      overallFeedback: "Good start.", status: "completed",
    });
    expect(reviewed.session.reviewStatus).toBe("completed");
    expect(reviewed.sessionReview?.finalScore).toBe(70);
  });
});
