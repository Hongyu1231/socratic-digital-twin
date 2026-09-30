import { describe, expect, it, vi } from "vitest";
import type { ClinicalCase } from "@/lib/domain";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import { ArchivedCaseError, SupersededCaseError } from "@/lib/repository/types";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";
const CLASS_ID = "44444444-4444-4444-8444-444444444444";
const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const PROFESSOR_ID = "66666666-6666-4666-8666-666666666666";

type QueryResult = { data: unknown; error: { message: string } | null };
type QueryAction = {
  table: string;
  operation: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    title: "Integrity test case",
    presenting_complaint: "A synthetic case for repository tests.",
    difficulty: "intermediate",
    status: "draft",
    tags: ["Use the supplied evidence."],
    source_case_id: null,
    version: 1,
    published_at: null,
    patient_context: {},
    attachments: [],
    ...overrides,
  };
}

function phaseRow() {
  return {
    id: PHASE_ID,
    case_id: CASE_ID,
    phase_order: 1,
    title: "Observe the record",
    objectives: ["Describe a specific finding.", "Name the supporting record."],
    questions: ["What do you observe?", "Which record supports that observation?"],
    teaching_notes: "Use the record as evidence.",
    expected_findings: {},
    metadata: {},
  };
}

function caseInput(overrides: Partial<ClinicalCase> = {}): ClinicalCase {
  return {
    id: CASE_ID,
    title: "Integrity test case",
    description: "A synthetic case for repository tests.",
    difficulty: "intermediate",
    status: "draft",
    learningObjectives: ["Use the supplied evidence."],
    attachments: [],
    findings: [],
    phases: [{
      id: PHASE_ID,
      caseId: CASE_ID,
      order: 1,
      title: "Observe the record",
      goal: "Describe a specific finding.",
      rubric: ["Name the supporting record."],
      starterQuestion: "What do you observe?",
      exampleQuestions: ["Which record supports that observation?"],
      tutorGuidance: [],
      tutorMoves: [],
    }],
    ...overrides,
  };
}

function repositoryWithClient(
  resolve: (action: QueryAction) => QueryResult,
  actions: QueryAction[],
) {
  const client = {
    from(table: string) {
      let operation = "select";
      let payload: unknown;
      const filters: Array<[string, unknown]> = [];
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = (field: string, value: unknown) => {
        filters.push([field, value]);
        return builder;
      };
      builder.in = (field: string, value: unknown) => {
        filters.push([field, value]);
        return builder;
      };
      builder.order = () => builder;
      builder.update = (value: unknown) => {
        operation = "update";
        payload = value;
        return builder;
      };
      builder.insert = (value: unknown) => {
        operation = "insert";
        payload = value;
        return builder;
      };
      builder.delete = () => {
        operation = "delete";
        return builder;
      };
      const result = () => {
        const action = { table, operation, payload, filters: [...filters] };
        actions.push(action);
        return resolve(action);
      };
      builder.maybeSingle = () => Promise.resolve(result());
      builder.single = () => Promise.resolve(result());
      builder.then = (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled, onRejected);
      return builder;
    },
    rpc(name: string, payload: unknown) {
      const action = { table: name, operation: "rpc", payload, filters: [] as Array<[string, unknown]> };
      actions.push(action);
      return Promise.resolve(resolve(action));
    },
  };
  const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
  Object.defineProperty(repository, "client", { value: client });
  return repository;
}

describe("SupabaseTutorRepository case integrity boundaries", () => {
  it("uses the atomic publish RPC and reports a lost publish race", async () => {
    const actions: QueryAction[] = [];
    const repository = repositoryWithClient((action) => {
      if (action.table === "cases" && action.operation === "select") return { data: caseRow(), error: null };
      if (action.table === "case_phases" && action.operation === "select") return { data: [phaseRow()], error: null };
      if (action.table === "publish_case" && action.operation === "rpc") return { data: null, error: { message: "Case changed before it could be published" } };
      throw new Error(`Unexpected ${action.table} ${action.operation}`);
    }, actions);

    await expect(repository.publishCase(CASE_ID)).rejects.toThrow(/changed before it could be published/i);
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "publish_case",
        operation: "rpc",
        payload: expect.objectContaining({ p_case_id: CASE_ID, p_move_open_assignments: true }),
      }),
    ]));
  });

  it("surfaces an atomic RPC failure without falling back to phase deletes or inserts", async () => {
    const actions: QueryAction[] = [];
    const repository = repositoryWithClient((action) => {
      if (action.table === "cases" && action.operation === "select") return { data: caseRow(), error: null };
      if (action.table === "case_phases" && action.operation === "select") return { data: [phaseRow()], error: null };
      if (action.table === "save_case_draft" && action.operation === "rpc") return { data: null, error: { message: "simulated phase constraint failure" } };
      throw new Error(`Unexpected ${action.table} ${action.operation}`);
    }, actions);

    await expect(repository.saveCase(caseInput({ difficulty: "advanced" }), ADMIN_ID))
      .rejects.toThrow(/save case: simulated phase constraint failure/i);
    expect(actions.some((action) => action.table === "case_phases" && action.operation === "insert")).toBe(false);
    expect(actions.some((action) => action.table === "case_phases" && action.operation === "delete")).toBe(false);
  });

  it("persists the selected difficulty on a newly saved case row", async () => {
    const actions: QueryAction[] = [];
    let insertedCaseId = "";
    const repository = repositoryWithClient((action) => {
      if (action.table === "save_case_draft" && action.operation === "rpc") {
        insertedCaseId = (action.payload as { p_case_id: string }).p_case_id;
        return { data: { id: insertedCaseId }, error: null };
      }
      throw new Error(`Unexpected ${action.table} ${action.operation}`);
    }, actions);
    vi.spyOn(repository, "getCase").mockImplementation(async () => caseInput({ id: insertedCaseId, difficulty: "advanced" }));

    const result = await repository.saveCase(caseInput({ id: "", difficulty: "advanced" }), ADMIN_ID);
    const save = actions.find((action) => action.table === "save_case_draft" && action.operation === "rpc");

    expect(save?.payload).toEqual(expect.objectContaining({
      p_difficulty: "advanced",
      p_phases: [expect.objectContaining({ metadata: expect.objectContaining({ rubric: expect.any(Array) }) })],
    }));
    expect(result.difficulty).toBe("advanced");
  });

  it.each([
    ["Cannot start a session for an archived case", ArchivedCaseError],
    ["Cannot start a session for a superseded case without an open assignment", SupersededCaseError],
  ])("maps a status trigger race to the public 410 error (%s)", async (triggerMessage, ExpectedError) => {
    const actions: QueryAction[] = [];
    const repository = repositoryWithClient((action) => {
      if (action.table === "class_case_assignments" && action.operation === "select") {
        return {
          data: {
            id: ASSIGNMENT_ID,
            class_id: CLASS_ID,
            case_id: CASE_ID,
            assigned_by: ADMIN_ID,
            status: "open",
            opens_at: "2026-01-01T00:00:00.000Z",
            due_at: null,
            created_at: "2026-01-01T00:00:00.000Z",
            cases: caseRow({ status: "active" }),
          },
          error: null,
        };
      }
      if (action.table === "class_memberships" && action.operation === "select") {
        return { data: { class_id: CLASS_ID }, error: null };
      }
      if (action.table === "case_phases" && action.operation === "select") {
        return { data: [phaseRow()], error: null };
      }
      if (action.table === "sessions" && action.operation === "select") {
        return { data: null, error: null };
      }
      if (action.table === "sessions" && action.operation === "insert") {
        return { data: null, error: { message: triggerMessage } };
      }
      throw new Error(`Unexpected ${action.table} ${action.operation}`);
    }, actions);

    await expect(repository.createSession(STUDENT_ID, CASE_ID, ASSIGNMENT_ID)).rejects.toBeInstanceOf(ExpectedError);
  });

  it("allows an owner to close a retained superseded assignment but rejects a new one", async () => {
    const actions: QueryAction[] = [];
    const classRow = {
      id: CLASS_ID,
      name: "Superseded assignment class",
      code: "SUP-ASSIGN",
      term: "2026",
      status: "active",
      created_by: PROFESSOR_ID,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const memberRow = { class_id: CLASS_ID, user_id: PROFESSOR_ID, role: "professor", is_lead: true };
    const caseValue = caseRow({ status: "superseded", title: "Old version" });
    let assignmentRow: Record<string, unknown> = {
      id: ASSIGNMENT_ID,
      class_id: CLASS_ID,
      case_id: CASE_ID,
      assigned_by: PROFESSOR_ID,
      status: "open",
      opens_at: "2026-01-01T00:00:00.000Z",
      due_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const repository = repositoryWithClient((action) => {
      if (action.table === "classes" && action.operation === "select") return { data: [classRow], error: null };
      if (action.table === "class_memberships" && action.operation === "select") return { data: [memberRow], error: null };
      if (action.table === "class_case_assignments" && action.operation === "select") {
        const lookupById = action.filters.some(([field, value]) => field === "id" && value === ASSIGNMENT_ID);
        if (lookupById) return { data: { ...assignmentRow }, error: null };
        return { data: [{ ...assignmentRow, classes: { name: classRow.name }, cases: { title: caseValue.title } }], error: null };
      }
      if (action.table === "cases" && action.operation === "select") return { data: caseValue, error: null };
      if (action.table === "case_phases" && action.operation === "select") return { data: [], error: null };
      if (action.table === "class_case_assignments" && action.operation === "update") {
        assignmentRow = { ...assignmentRow, ...(action.payload as Record<string, unknown>) };
        return { data: { id: ASSIGNMENT_ID }, error: null };
      }
      throw new Error(`Unexpected ${action.table} ${action.operation}`);
    }, actions);

    const closed = await repository.saveAssignment({
      id: ASSIGNMENT_ID,
      classId: CLASS_ID,
      caseId: CASE_ID,
      status: "closed",
      opensAt: "2026-01-01T00:00:00.000Z",
      dueAt: null,
    }, PROFESSOR_ID);
    expect(closed).toMatchObject({ id: ASSIGNMENT_ID, caseId: CASE_ID, status: "closed" });

    await expect(repository.saveAssignment({
      classId: CLASS_ID,
      caseId: CASE_ID,
      status: "open",
      opensAt: "2026-01-01T00:00:00.000Z",
      dueAt: null,
    }, PROFESSOR_ID)).rejects.toThrow(/only active cases/i);
    expect(actions.some((action) => action.table === "class_case_assignments" && ["insert", "upsert"].includes(action.operation))).toBe(false);
  });

  it("rejects unknown IDs and cross-class IDs before any assignment write", async () => {
    const unknownActions: QueryAction[] = [];
    const unknownRepository = repositoryWithClient((action) => {
      if (action.table === "class_case_assignments" && action.operation === "select") return { data: null, error: null };
      throw new Error(`Unexpected ${action.table} ${action.operation}`);
    }, unknownActions);
    await expect(unknownRepository.saveAssignment({
      id: "77777777-7777-4777-8777-777777777777",
      classId: CLASS_ID,
      caseId: CASE_ID,
      status: "closed",
      opensAt: "2026-01-01T00:00:00.000Z",
      dueAt: null,
    }, PROFESSOR_ID)).rejects.toThrow(/assignment not found/i);

    const crossClassActions: QueryAction[] = [];
    const crossClassRepository = repositoryWithClient((action) => {
      if (action.table === "class_case_assignments" && action.operation === "select") {
        return { data: { id: ASSIGNMENT_ID, class_id: "88888888-8888-4888-8888-888888888888", case_id: CASE_ID }, error: null };
      }
      if (action.table === "classes" && action.operation === "select") return {
        data: [{ id: CLASS_ID, name: "Owned class", code: "OWNED", term: "2026", status: "active", created_by: PROFESSOR_ID, created_at: "2026-01-01T00:00:00.000Z" }],
        error: null,
      };
      if (action.table === "class_memberships" && action.operation === "select") return {
        data: [{ class_id: CLASS_ID, user_id: PROFESSOR_ID, role: "professor", is_lead: true }],
        error: null,
      };
      throw new Error(`Unexpected ${action.table} ${action.operation}`);
    }, crossClassActions);
    await expect(crossClassRepository.saveAssignment({
      id: ASSIGNMENT_ID,
      classId: CLASS_ID,
      caseId: CASE_ID,
      status: "closed",
      opensAt: "2026-01-01T00:00:00.000Z",
      dueAt: null,
    }, PROFESSOR_ID)).rejects.toThrow(/outside this class/i);
  });
});
