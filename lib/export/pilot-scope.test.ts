import { describe, expect, it, vi } from "vitest";

import { buildPilotExport, PilotExportRefusedError, studentCodesFor } from "@/lib/export/pilot-export";
import { loadPilotExportInput } from "@/lib/export/pilot-zip";
import { assignments, fixtureSessions, SECRET_NAMES, teachingClass, users } from "@/lib/export/pilot-fixtures";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import { demoClass } from "@/lib/seed";

const EXPORTED_AT = new Date("2026-11-05T16:30:00.000Z");
const withStudentEmail = (email: string) => ({
  ...teachingClass,
  members: teachingClass.members.map((member) => member.userId === users.r10!.id ? { ...member, user: { ...member.user!, email } } : member),
});

describe("pilot export study codes", () => {
  it("takes codes from the hidden sign-in email and ignores real-looking display names", () => {
    const data = buildPilotExport({ teachingClass, assignments, sessions: fixtureSessions(), exportedAt: EXPORTED_AT });
    expect(new Set(data.summary.map((row) => row.code))).toEqual(new Set(["R02", "R03", "R10"]));
    const text = JSON.stringify(data);
    for (const name of SECRET_NAMES) expect(text).not.toContain(name);
    expect(data.summary.every((row) => /^R\d{2}(-attempt-\d+)?\.docx$/.test(row.fileName))).toBe(true);
  });

  it.each([
    ["a staff-style email", "benjamin.lee@u.nus.edu"],
    ["an invalid code", "r_10!@pilot.invalid"],
    ["no email at all", ""],
  ])("refuses the whole export when a student has %s, without naming anyone", (_label, email) => {
    const refused = () => buildPilotExport({ teachingClass: withStudentEmail(email), assignments, sessions: fixtureSessions(), exportedAt: EXPORTED_AT });
    expect(refused).toThrow(PilotExportRefusedError);
    expect(refused).toThrow("This class has 1 student without a study code, so the data can't be exported anonymously.");
    try { refused(); } catch (error) {
      for (const secret of [...SECRET_NAMES, email].filter(Boolean)) expect((error as Error).message).not.toContain(secret);
    }
  });

  it("refuses when a student's user record is missing", () => {
    const missingUser = { ...teachingClass, members: teachingClass.members.map((member) => member.role === "student" ? { ...member, user: undefined } : member) };
    expect(() => studentCodesFor(missingUser)).toThrow("This class has 3 students without a study code");
  });

  it("refuses the demo class", async () => {
    const repository = new InMemoryTutorRepository();
    const loaded = await repository.getClass(demoClass.id);
    expect(loaded).not.toBeNull();
    expect(() => studentCodesFor(loaded!)).toThrow(/students? without a study code, so the data can't be exported anonymously/);
  });
});

describe("pilot export loading is scoped to one class", () => {
  it("loads only the class's assignments and their sessions", async () => {
    const repository = {
      listAssignmentsForClass: vi.fn(async () => [assignments[0]!]),
      listSessionsForAssignments: vi.fn(async () => []),
      listAssignments: vi.fn(), listSessions: vi.fn(), listClasses: vi.fn(),
    };
    await loadPilotExportInput(repository, teachingClass, EXPORTED_AT);
    expect(repository.listAssignmentsForClass).toHaveBeenCalledWith(teachingClass.id);
    expect(repository.listSessionsForAssignments).toHaveBeenCalledWith([assignments[0]!.id]);
    for (const global of [repository.listAssignments, repository.listSessions, repository.listClasses]) expect(global).not.toHaveBeenCalled();
  });

  it("the memory repository returns only the requested class's rows", async () => {
    const repository = new InMemoryTutorRepository();
    const classAssignments = await repository.listAssignmentsForClass(demoClass.id);
    expect(classAssignments.length).toBeGreaterThan(0);
    expect(classAssignments.every((item) => item.classId === demoClass.id)).toBe(true);
    expect(await repository.listAssignmentsForClass("no-such-class")).toEqual([]);
    expect(await repository.listSessionsForAssignments([])).toEqual([]);
  });
});

/** Records every table and filter the Supabase repository asks for. */
function recordingClient(rows: Record<string, unknown>) {
  const calls: Array<{ table: string; filters: string[] }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        const call = { table, filters: [] as string[] };
        calls.push(call);
        const data = rows[table] ?? [];
        const builder = {
          select() { return builder; },
          order() { return builder; },
          eq(column: string, value: unknown) { call.filters.push(`${column}=${String(value)}`); return builder; },
          in(column: string, values: unknown[]) { call.filters.push(`${column} in ${values.join(",")}`); return builder; },
          maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] ?? null : data, error: null }),
          then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return builder;
      },
    },
  };
}

function supabaseRepository(rows: Record<string, unknown>) {
  const { client, calls } = recordingClient(rows);
  const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
  Object.defineProperty(repository, "client", { value: client });
  return { repository, calls };
}

describe("Supabase scoped export queries", () => {
  it("getClass filters the class and its memberships by class id", async () => {
    const { repository, calls } = supabaseRepository({
      classes: [{ id: "class-1", name: "Pilot", code: "P", term: "2026", status: "active", created_by: "admin", created_at: "2026-01-01" }],
      class_memberships: [{ class_id: "class-1", user_id: "u1", role: "student", is_lead: false, users: { id: "u1", display_name: "Real Name", email: "r05@pilot.invalid", role: "student", is_active: true } }],
    });
    const loaded = await repository.getClass("class-1");
    expect(loaded?.members[0]?.user?.email).toBe("r05@pilot.invalid");
    expect(calls).toEqual([
      { table: "classes", filters: ["id=class-1"] },
      { table: "class_memberships", filters: ["class_id=class-1"] },
    ]);
  });

  it("listAssignmentsForClass filters by class id", async () => {
    const { repository, calls } = supabaseRepository({ class_case_assignments: [] });
    await repository.listAssignmentsForClass("class-1");
    expect(calls).toEqual([{ table: "class_case_assignments", filters: ["class_id=class-1"] }]);
  });

  it("listSessionsForAssignments filters by assignment id, and skips the query with none", async () => {
    const { repository, calls } = supabaseRepository({ sessions: [] });
    await repository.listSessionsForAssignments(["a1", "a2"]);
    expect(calls).toEqual([{ table: "sessions", filters: ["class_case_assignment_id in a1,a2"] }]);
    calls.length = 0;
    expect(await repository.listSessionsForAssignments([])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
