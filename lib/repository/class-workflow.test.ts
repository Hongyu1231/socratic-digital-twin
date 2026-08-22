import { beforeEach, describe, expect, it } from "vitest";
import type { Evaluation, TutorMessage } from "@/lib/domain";
import { resetRepositoryForTests } from "@/lib/repository";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import {
  DEMO_ADMIN_ID,
  DEMO_ASSIGNMENT_ID,
  DEMO_CLASS_ID,
  DEMO_PROFESSOR_2_ID,
  DEMO_PROFESSOR_ID,
  DEMO_STUDENT_ID,
  IMPACTED_CANINE_CASE_ID,
} from "@/lib/seed";

describe("InMemoryTutorRepository class workflows", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
  });

  it("lists student offerings and resumes one session per assignment", async () => {
    const offerings = await repository.listStudentOfferings(DEMO_STUDENT_ID);
    expect(offerings).toHaveLength(5);
    expect(offerings.some((item) => item.case.phases.length === 6)).toBe(true);
    const offering = offerings.find((item) => item.assignment.id === DEMO_ASSIGNMENT_ID);

    expect(offering).toMatchObject({
      assignment: { id: DEMO_ASSIGNMENT_ID, classId: DEMO_CLASS_ID, caseId: IMPACTED_CANINE_CASE_ID },
      teachingClass: { id: DEMO_CLASS_ID },
      case: { id: IMPACTED_CANINE_CASE_ID },
      existingSessionId: null,
      availability: "open",
    });

    const first = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const resumed = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);

    expect(resumed.session.id).toBe(first.session.id);
    expect(await repository.listSessions()).toHaveLength(1);
    await expect(repository.listStudentOfferings(DEMO_STUDENT_ID)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignment: expect.objectContaining({ id: DEMO_ASSIGNMENT_ID }), existingSessionId: first.session.id }),
      ]),
    );
  });

  it("persists a paused session and exposes it as resumable from the case list", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const pausedAt = "2026-08-14T08:00:00.000Z";

    const paused = await repository.setSessionPaused(started.session.id, pausedAt);
    expect(paused.session.pausedAt).toBe(pausedAt);
    await expect(repository.listStudentOfferings(DEMO_STUDENT_ID)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          existingSessionId: started.session.id,
          existingSessionStatus: "active",
          existingSessionPausedAt: pausedAt,
        }),
      ]),
    );

    const resumed = await repository.setSessionPaused(started.session.id, null);
    expect(resumed.session.pausedAt).toBeNull();
  });

  it("only exposes sessions from classes where the professor is a member", async () => {
    const privateClass = await repository.saveClass({
      id: "88888888-8888-4888-8888-888888888888",
      name: "Professor One Seminar",
      code: "P1-ONLY",
      term: "AY2026/27 Semester 1",
      status: "active",
      createdBy: DEMO_ADMIN_ID,
    });
    await repository.setClassMembers(privateClass.id, [
      { classId: privateClass.id, userId: DEMO_PROFESSOR_ID, role: "professor", isLead: true },
      { classId: privateClass.id, userId: DEMO_STUDENT_ID, role: "student", isLead: false },
    ]);
    const assignment = await repository.saveAssignment(
      {
        id: "77777777-7777-4777-8777-777777777777",
        classId: privateClass.id,
        caseId: IMPACTED_CANINE_CASE_ID,
        status: "open",
        opensAt: "2026-08-09T00:00:00.000Z",
        dueAt: null,
      },
      DEMO_PROFESSOR_ID,
    );
    const session = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, assignment.id);

    const professorOneSessions = await repository.listSessionsForProfessor(DEMO_PROFESSOR_ID);
    const professorTwoSessions = await repository.listSessionsForProfessor(DEMO_PROFESSOR_2_ID);

    expect(professorOneSessions.map((item) => item.session.id)).toContain(session.session.id);
    expect(professorTwoSessions).toHaveLength(0);
  });

  it("lets the first class professor claim a review and rejects a competing professor", async () => {
    const started = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const now = new Date().toISOString();
    const studentMessage: TutorMessage = {
      id: crypto.randomUUID(),
      sessionId: started.session.id,
      sender: "student",
      content: "The canine is unerupted and the eruption timing is asymmetric, suggesting impaction.",
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
      feedback: "Explain what you would check next.",
      createdAt: now,
    };
    const aiMessage: TutorMessage = {
      id: crypto.randomUUID(),
      sessionId: started.session.id,
      sender: "ai",
      content: "What would you investigate next?",
      timestamp: new Date(Date.now() + 1).toISOString(),
      replyToMessageId: studentMessage.id,
    };

    await repository.commitTurn({
      sessionId: started.session.id,
      expectedVersion: started.session.state.version,
      studentMessage,
      evaluation,
      aiMessage,
      nextState: { ...started.session.state, version: started.session.state.version + 1, updatedAt: now },
      nextPhase: started.session.currentPhase,
      status: "active",
      score: null,
      summary: null,
      completedAt: null,
    });
    await repository.completeSession(started.session.id, {
      overallScore: 70,
      headline: "Early learning summary",
      narrative: "One answer was submitted before the session ended.",
      strengths: ["Identified relevant evidence"],
      weaknesses: ["Needs a clearer consequence"],
      nextSteps: ["Connect evidence to clinical impact"],
      completedAllPhases: false,
    }, new Date().toISOString());

    const reviewInput = {
      sessionId: started.session.id,
      reviews: [{ evaluationId: evaluation.id, label: "partial" as const, comments: "Needs a clearer consequence." }],
      overallFeedback: "Good starting point.",
      status: "draft" as const,
    };
    await repository.saveReview({ ...reviewInput, professorId: DEMO_PROFESSOR_ID });

    const claimedForOwner = (await repository.listSessionsForProfessor(DEMO_PROFESSOR_ID)).find((item) => item.session.id === started.session.id);
    const claimedForOther = (await repository.listSessionsForProfessor(DEMO_PROFESSOR_2_ID)).find((item) => item.session.id === started.session.id);
    expect(claimedForOwner?.reviewClaim).toMatchObject({ reviewerId: DEMO_PROFESSOR_ID, state: "mine", canEdit: true });
    expect(claimedForOther?.reviewClaim).toMatchObject({ reviewerId: DEMO_PROFESSOR_ID, state: "other", canEdit: false });

    await expect(repository.saveReview({ ...reviewInput, professorId: DEMO_PROFESSOR_2_ID })).rejects.toThrow(
      "Review already claimed by another professor.",
    );
  });

  it("keeps published cases immutable and clones a new draft version", async () => {
    const source = await repository.getCase(IMPACTED_CANINE_CASE_ID);
    expect(source).not.toBeNull();

    await expect(
      repository.saveCase({ ...source!, title: "Edited published case" }, DEMO_ADMIN_ID),
    ).rejects.toThrow("Published cases are immutable. Clone a new version.");
    await expect(repository.getCase(IMPACTED_CANINE_CASE_ID)).resolves.toEqual(source);

    const clone = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);
    expect(clone.id).not.toBe(source!.id);
    expect(clone).toMatchObject({
      title: `${source!.title} v${(source!.version ?? 1) + 1}`,
      status: "draft",
      sourceCaseId: source!.id,
      version: (source!.version ?? 1) + 1,
      publishedAt: null,
    });
    expect(clone.phases).toHaveLength(source!.phases.length);
    expect(clone.phases.every((phase, index) => phase.caseId === clone.id && phase.id !== source!.phases[index].id)).toBe(true);

    const nextClone = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);
    expect(nextClone).toMatchObject({
      title: `${source!.title} v${(source!.version ?? 1) + 2}`,
      sourceCaseId: source!.id,
      version: (source!.version ?? 1) + 2,
    });
  });

  it("archives an unpublished draft without inventing a publication timestamp", async () => {
    const draft = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);
    expect(draft).toMatchObject({ status: "draft", publishedAt: null });

    const archived = await repository.archiveCase(draft.id);
    expect(archived).toMatchObject({ status: "archived", publishedAt: null });
  });

  it("closes assignments and rejects a new session when a case is archived", async () => {
    const assignment = await repository.saveAssignment({
      classId: DEMO_CLASS_ID,
      caseId: IMPACTED_CANINE_CASE_ID,
      status: "open",
      opensAt: "2026-08-09T00:00:00.000Z",
      dueAt: null,
    }, DEMO_PROFESSOR_ID);

    await repository.archiveCase(IMPACTED_CANINE_CASE_ID);

    expect((await repository.listAssignments()).find((item) => item.id === assignment.id)?.status).toBe("closed");
    await expect(repository.listStudentOfferings(DEMO_STUDENT_ID)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ assignment: expect.objectContaining({ id: assignment.id }) })]),
    );
    await expect(repository.createSessionForAssignment(DEMO_STUDENT_ID, assignment.id)).rejects.toMatchObject({
      name: "ArchivedCaseError",
      message: expect.stringContaining("archived"),
    });
  });

  it("upserts repeated assignment writes that use the same idempotency key", async () => {
    const input = {
      classId: DEMO_CLASS_ID,
      caseId: IMPACTED_CANINE_CASE_ID,
      status: "open" as const,
      opensAt: "2026-08-09T00:00:00.000Z",
      dueAt: null,
      idempotencyKey: "e2e:assignment:canine:student-1",
    };
    const first = await repository.saveAssignment(input, DEMO_PROFESSOR_ID);
    const second = await repository.saveAssignment({ ...input, dueAt: "2026-12-31T00:00:00.000Z" }, DEMO_PROFESSOR_ID);

    expect(second.id).toBe(first.id);
    expect((await repository.listAssignments()).filter((item) => item.idempotencyKey === input.idempotencyKey)).toHaveLength(1);
    expect(second.dueAt).toBe("2026-12-31T00:00:00.000Z");
  });
});
