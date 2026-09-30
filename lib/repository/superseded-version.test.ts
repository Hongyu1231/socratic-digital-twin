import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import {
  DEMO_ADMIN_ID,
  DEMO_PROFESSOR_ID,
  DEMO_STUDENT_2_ID,
  DEMO_STUDENT_ID,
  IMPACTED_CANINE_CASE_ID,
} from "@/lib/seed";

describe("superseded case versions", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
  });

  it("supersedes the prior active version, moves open assignments, and keeps an existing session on its case", async () => {
    const assignment = (await repository.listAssignments()).find((item) => item.caseId === IMPACTED_CANINE_CASE_ID && item.status === "open");
    expect(assignment).toBeDefined();
    const existing = await repository.createSessionForAssignment(DEMO_STUDENT_ID, assignment!.id);
    const draft = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);

    const published = await repository.publishCase(draft.id);

    expect(published).toMatchObject({ id: draft.id, status: "available", version: 2 });
    await expect(repository.getCase(IMPACTED_CANINE_CASE_ID)).resolves.toMatchObject({ status: "superseded" });
    expect((await repository.listAssignments()).find((item) => item.id === assignment!.id)).toMatchObject({ caseId: draft.id });

    const existingOffering = (await repository.listStudentOfferings(DEMO_STUDENT_ID)).find((item) => item.assignment.id === assignment!.id);
    expect(existingOffering).toMatchObject({ case: { id: IMPACTED_CANINE_CASE_ID, status: "superseded" }, existingSessionId: existing.session.id });

    const newStudentOffering = (await repository.listStudentOfferings(DEMO_STUDENT_2_ID)).find((item) => item.assignment.id === assignment!.id);
    expect(newStudentOffering).toMatchObject({ case: { id: draft.id, status: "available" }, existingSessionId: null });
  });

  it("keeps an open assignment on the superseded version when moving is disabled", async () => {
    const assignment = (await repository.listAssignments()).find((item) => item.caseId === IMPACTED_CANINE_CASE_ID && item.status === "open");
    const draft = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);

    await repository.publishCase(draft.id, false);

    expect((await repository.listAssignments()).find((item) => item.id === assignment!.id)).toMatchObject({ caseId: IMPACTED_CANINE_CASE_ID, status: "open" });
    const offering = (await repository.listStudentOfferings(DEMO_STUDENT_2_ID)).find((item) => item.assignment.id === assignment!.id);
    expect(offering).toMatchObject({ case: { id: IMPACTED_CANINE_CASE_ID, status: "superseded" }, availability: "open" });
    const started = await repository.createSessionForAssignment(DEMO_STUDENT_2_ID, assignment!.id);
    expect(started.session.caseId).toBe(IMPACTED_CANINE_CASE_ID);
  });

  it("lets the owner close a retained superseded assignment but rejects a new one", async () => {
    const assignment = (await repository.listAssignments()).find((item) => item.caseId === IMPACTED_CANINE_CASE_ID && item.status === "open");
    const draft = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);
    await repository.publishCase(draft.id, false);

    const closed = await repository.saveAssignment({
      ...assignment!,
      status: "closed",
    }, DEMO_PROFESSOR_ID);
    expect(closed).toMatchObject({ id: assignment!.id, caseId: IMPACTED_CANINE_CASE_ID, status: "closed" });

    await expect(repository.saveAssignment({
      classId: assignment!.classId,
      caseId: IMPACTED_CANINE_CASE_ID,
      status: "open",
      opensAt: assignment!.opensAt,
      dueAt: null,
    }, DEMO_PROFESSOR_ID)).rejects.toThrow(/only active cases/i);
  });

  it("checks the current assignment owner before accepting an ID update", async () => {
    const assignment = (await repository.listAssignments()).find((item) => item.caseId === IMPACTED_CANINE_CASE_ID && item.status === "open");
    await expect(repository.saveAssignment({
      ...assignment!,
      id: "99999999-9999-4999-8999-999999999998",
      status: "closed",
    }, DEMO_PROFESSOR_ID)).rejects.toThrow(/assignment not found/i);
  });

  it("fails before changing data when a lineage already has multiple active versions", async () => {
    const firstDraft = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);
    const secondDraft = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);
    const store = (repository as unknown as { store: { cases: Map<string, { status: string; publishedAt: string | null }> } }).store;
    const first = store.cases.get(firstDraft.id)!;
    first.status = "available";
    first.publishedAt = new Date().toISOString();

    await expect(repository.publishCase(secondDraft.id)).rejects.toThrow(/multiple active versions/i);
    expect(store.cases.get(secondDraft.id)?.status).toBe("draft");
  });
});
