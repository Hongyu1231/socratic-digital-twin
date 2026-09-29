import { describe, expect, it, vi } from "vitest";
import type { Evaluation, TutorMessage } from "@/lib/domain";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { DEMO_ASSIGNMENT_ID, DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";

type Result = { data: unknown; error: null };

function fakeClient(tableRows: Record<string, unknown>, calls: string[]) {
  return {
    from(table: string) {
      calls.push(table);
      const result: Result = { data: tableRows[table] ?? [], error: null };
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function repositoryWithRows(tableRows: Record<string, unknown>, calls: string[]) {
  const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
  Object.defineProperty(repository, "client", { value: fakeClient(tableRows, calls) });
  return repository;
}

const phase = (caseId: string, id: string) => ({
  id,
  case_id: caseId,
  phase_order: 1,
  title: "Reasoning",
  objectives: ["Connect evidence"],
  questions: ["What do you notice?"],
  teaching_notes: "Connect evidence",
  expected_findings: {},
});

describe("SupabaseTutorRepository student catalogue batching", () => {
  it("uses one batched membership/session/case/phase query set and never hydrates sessions per assignment", async () => {
    const calls: string[] = [];
    const repository = repositoryWithRows({
      class_memberships: [{ class_id: "class-1", user_id: "student-1", role: "student", is_lead: false, users: { id: "student-1", display_name: "Student", email: "student@example.com", role: "student", is_active: true, profile: {} }, classes: { id: "class-1", name: "Demo", code: "D", term: "2026", status: "active", created_by: "prof-1", created_at: "2026-01-01" } }],
      class_case_assignments: [
        { id: "assignment-1", class_id: "class-1", case_id: "case-1", assigned_by: "prof-1", status: "open", opens_at: "2026-01-01", due_at: null, created_at: "2026-01-01", cases: { title: "Available" } },
        { id: "assignment-2", class_id: "class-1", case_id: "case-2", assigned_by: "prof-1", status: "open", opens_at: "2026-01-01", due_at: null, created_at: "2026-01-02", cases: { title: "Archived" } },
        { id: "assignment-3", class_id: "class-1", case_id: "case-3", assigned_by: "prof-1", status: "open", opens_at: "2026-01-01", due_at: null, created_at: "2026-01-03", cases: { title: "Fixture" } },
        { id: "assignment-closed", class_id: "class-1", case_id: "case-1", assigned_by: "prof-1", status: "closed", opens_at: "2026-01-01", due_at: null, created_at: "2026-01-04", cases: { title: "Available" } },
        { id: "assignment-upcoming", class_id: "class-1", case_id: "case-upcoming", assigned_by: "prof-1", status: "open", opens_at: "2999-01-01", due_at: null, created_at: "2026-01-05", cases: { title: "Upcoming" } },
      ],
      sessions: [
        { id: "session-1", class_case_assignment_id: "assignment-1", status: "active", context: { pausedAt: null } },
        { id: "session-closed", class_case_assignment_id: "assignment-closed", status: "completed", context: { pausedAt: null } },
      ],
      cases: [
        { id: "case-1", title: "Available", status: "active", presenting_complaint: "", is_test_fixture: false, source_case_id: null, version: 1, published_at: null, attachments: [{ id: "123e4567-e89b-42d3-a456-426614174000", kind: "image", title: "OPG", description: "A teaching panoramic radiograph.", url: "/media/opg.jpg" }] },
        { id: "case-2", title: "Archived", status: "archived", presenting_complaint: "", is_test_fixture: false, source_case_id: null, version: 1, published_at: null },
        { id: "case-3", title: "Fixture", status: "active", presenting_complaint: "", is_test_fixture: true, source_case_id: null, version: 1, published_at: null },
        { id: "case-upcoming", title: "Upcoming", status: "active", presenting_complaint: "", is_test_fixture: false, source_case_id: null, version: 1, published_at: null },
      ],
      case_phases: [phase("case-1", "phase-1"), phase("case-2", "phase-2"), phase("case-3", "phase-3"), phase("case-upcoming", "phase-upcoming")],
    }, calls);
    const listSessions = vi.spyOn(repository, "listSessions");
    const getSession = vi.spyOn(repository, "getSession");
    const getCase = vi.spyOn(repository, "getCase");

    const offerings = await repository.listStudentOfferings("student-1");

    expect(offerings).toHaveLength(2);
    expect(offerings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignment: expect.objectContaining({ id: "assignment-1" }), case: expect.objectContaining({ id: "case-1" }), existingSessionId: "session-1" }),
      expect.objectContaining({ assignment: expect.objectContaining({ id: "assignment-upcoming" }), availability: "upcoming", existingSessionId: null }),
    ]));
    expect(offerings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ assignment: expect.objectContaining({ id: "assignment-closed" }) }),
    ]));
    expect(offerings.find((item) => item.case.id === "case-1")?.case.attachments).toEqual([
      expect.objectContaining({ kind: "image", title: "OPG", url: "/media/opg.jpg" }),
    ]);
    expect(listSessions).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(getCase).not.toHaveBeenCalled();
    expect(calls.filter((table) => table === "classes")).toHaveLength(0);
    expect(calls.filter((table) => table === "class_memberships")).toHaveLength(1);
    expect(calls.filter((table) => table === "class_case_assignments")).toHaveLength(1);
    expect(calls.filter((table) => table === "sessions")).toHaveLength(1);
    expect(calls.filter((table) => table === "cases")).toHaveLength(1);
    expect(calls.filter((table) => table === "case_phases")).toHaveLength(1);
    expect(calls).toHaveLength(5);
  });

  it("loads all class memberships in one query regardless of class count", async () => {
    const calls: string[] = [];
    const repository = repositoryWithRows({
      classes: [
        { id: "class-1", name: "One", code: "1", term: "2026", status: "active", created_by: "prof-1", created_at: "2026-01-01" },
        { id: "class-2", name: "Two", code: "2", term: "2026", status: "active", created_by: "prof-1", created_at: "2026-01-02" },
        { id: "class-3", name: "Three", code: "3", term: "2026", status: "active", created_by: "prof-1", created_at: "2026-01-03" },
      ],
      class_memberships: [],
    }, calls);

    await repository.listClasses();

    expect(calls.filter((table) => table === "class_memberships")).toHaveLength(1);
  });

  it("stores reflection turns without a graded database score", async () => {
    const memory = new InMemoryTutorRepository();
    memory.reset();
    const started = await memory.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID);
    const now = new Date().toISOString();
    const studentMessage: TutorMessage = {
      id: crypto.randomUUID(), sessionId: started.session.id, sender: "student",
      content: "I would reassess the key uncertainty.", timestamp: now,
    };
    const evaluation: Evaluation = {
      id: crypto.randomUUID(), messageId: studentMessage.id, classification: "correct",
      confidence: 0.95, reasoningGap: "", strategy: "reflect", phaseComplete: false,
      feedback: "Reflect on the decision.", isReflection: true, createdAt: now,
    };
    const aiMessage: TutorMessage = {
      id: crypto.randomUUID(), sessionId: started.session.id, sender: "ai",
      content: "What uncertainty mattered most?", timestamp: now, moveType: "reflection",
    };
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
    Object.defineProperty(repository, "client", { value: { rpc } });
    vi.spyOn(repository, "getSession").mockResolvedValue(started);

    await repository.commitTurn({
      sessionId: started.session.id,
      expectedVersion: started.session.state.version,
      clientRequestId: "reflection-turn-123",
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

    expect(rpc).toHaveBeenCalledWith("commit_tutor_turn", expect.objectContaining({ p_evaluation_score: null }));
  });

});
