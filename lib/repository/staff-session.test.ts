import { describe, expect, it, vi } from "vitest";
import { DEMO_ASSIGNMENT_ID, DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import { decodeStaffSessionCursor, encodeStaffSessionCursor } from "@/lib/repository/staff-session";

const PROFESSOR_ID = "22222222-2222-4222-8222-222222222222";
const CLASS_ID = "55555555-5555-4555-8555-555555555555";
const SESSION_ID = "77777777-7777-4777-8777-777777777777";
const CASE_ID = "88888888-8888-4888-8888-888888888888";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const ASSIGNMENT_ID = "99999999-9999-4999-8999-999999999999";

describe("staff session repository contract", () => {
  it("rejects malformed cursors before issuing a database request", async () => {
    const rpc = vi.fn();
    const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
    Object.defineProperty(repository, "client", { value: { rpc } });

    await expect(repository.listStaffSessions({ cursor: "not-a-cursor" }, PROFESSOR_ID))
      .rejects.toMatchObject({ code: "INVALID_STAFF_SESSION_CURSOR" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects cursor payloads with non-ISO timestamps even when the UUID is valid", () => {
    const cursor = encodeStaffSessionCursor({ createdAt: "0", id: SESSION_ID });
    expect(() => decodeStaffSessionCursor(cursor)).toThrow(/cursor is invalid/i);
  });

  it("uses bounded page and aggregate RPCs without hydrating transcripts", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_staff_session_summaries") {
        return {
          data: [{
            session_id: SESSION_ID,
            case_id: CASE_ID,
            case_title: "A bounded case",
            case_version: 2,
            student_id: STUDENT_ID,
            student_name: "Student",
            assignment_id: ASSIGNMENT_ID,
            assignment_class_id: CLASS_ID,
            class_name: "Tutor class",
            session_status: "completed",
            review_status: "pending",
            score: 82,
            created_at: "2026-09-30T10:00:00.000Z",
            completed_at: "2026-09-30T10:05:00.000Z",
            reviewer_id: null,
            reviewer_name: null,
          }],
          error: null,
        };
      }
      return {
        data: [{
          total: 4,
          completed: 3,
          reviewed: 1,
          available: 2,
          mine: 1,
          claimed: 0,
          assignment_progress: { [ASSIGNMENT_ID]: { sessionCount: 4, completedCount: 3 } },
        }],
        error: null,
      };
    });
    const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
    Object.defineProperty(repository, "client", { value: { rpc } });

    const page = await repository.listStaffSessions({ limit: 25, classId: CLASS_ID, reviewFilter: "all" }, PROFESSOR_ID);

    expect(page).toMatchObject({
      sessions: [{
        session: { id: SESSION_ID, caseId: CASE_ID, assignmentId: ASSIGNMENT_ID, status: "completed", score: 82 },
        case: { id: CASE_ID, title: "A bounded case", version: 2 },
        student: { id: STUDENT_ID, name: "Student" },
        assignment: { id: ASSIGNMENT_ID, classId: CLASS_ID },
        teachingClass: { id: CLASS_ID, name: "Tutor class" },
        reviewClaim: { state: "unclaimed", canEdit: true },
      }],
      stats: { total: 4, completed: 3, reviewed: 1, available: 2, mine: 1, claimed: 0 },
      assignmentProgress: { [ASSIGNMENT_ID]: { sessionCount: 4, completedCount: 3 } },
    });
    expect(page.nextCursor).toBeNull();
    expect(rpc).toHaveBeenCalledWith("list_staff_session_summaries", {
      p_professor_id: PROFESSOR_ID,
      p_class_id: CLASS_ID,
      p_review_filter: "all",
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_limit: 25,
    });
    expect(rpc).toHaveBeenCalledWith("get_staff_session_rollup", {
      p_professor_id: PROFESSOR_ID,
      p_class_id: CLASS_ID,
    });
  });

  it("returns the same fully initialized in-memory session for concurrent starts", async () => {
    const repository = new InMemoryTutorRepository();
    repository.reset();

    const sessions = await Promise.all([
      repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID),
      repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID, DEMO_ASSIGNMENT_ID),
    ]);

    expect(sessions[0].session.id).toBe(sessions[1].session.id);
    expect(sessions[0].session.state).toBeTruthy();
    expect(sessions[0].session.messages).toHaveLength(1);
    expect(await repository.listSessions()).toHaveLength(1);
  });

  it("encodes cursors with the stable created-at and id ordering fields", () => {
    const cursor = encodeStaffSessionCursor({ createdAt: "2026-09-30T10:00:00.000Z", id: SESSION_ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
