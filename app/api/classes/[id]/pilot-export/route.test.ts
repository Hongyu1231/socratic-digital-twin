import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_ID, ASSIGNMENT_ID, assignments, CLASS_ID, fixtureSessions, OTHER_PROFESSOR_ID, otherClass, PROFESSOR_ID, teachingClass, users,
} from "@/lib/export/pilot-fixtures";

const mocks = vi.hoisted(() => ({ getIdentity: vi.fn(), getRepository: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error { status = 401; },
  getIdentity: mocks.getIdentity,
}));
vi.mock("@/lib/repository", () => ({ getRepository: mocks.getRepository }));

import { GET } from "@/app/api/classes/[id]/pilot-export/route";

const call = (classId = CLASS_ID) => GET(new Request(`http://localhost/api/classes/${classId}/pilot-export`), { params: Promise.resolve({ id: classId }) });

describe("pilot export route", () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mocks.getIdentity.mockReset();
    repository = {
      getClass: vi.fn(async (id: string) => [teachingClass, otherClass].find((item) => item.id === id) ?? null),
      listAssignmentsForClass: vi.fn(async (classId: string) => assignments.filter((item) => item.classId === classId)),
      listSessionsForAssignments: vi.fn(async (ids: string[]) => fixtureSessions().filter((item) => ids.includes(item.session.assignmentId!))),
      listClasses: vi.fn(), listAssignments: vi.fn(), listSessions: vi.fn(),
    };
    mocks.getRepository.mockReturnValue(repository);
  });

  const expectNoDataLoaded = () => {
    for (const name of ["listAssignmentsForClass", "listSessionsForAssignments", "listClasses", "listAssignments", "listSessions"]) expect(repository[name]).not.toHaveBeenCalled();
  };

  it("refuses a student, even one enrolled in the class", async () => {
    mocks.getIdentity.mockResolvedValue({ ...users.r03, role: "student" });
    const response = await call();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("Only faculty teaching this class and admins can download its pilot data. Ask the lead professor or an admin if you need a copy.");
    expect(repository.getClass).not.toHaveBeenCalled();
    expectNoDataLoaded();
  });

  it("refuses a professor who doesn't teach this class", async () => {
    mocks.getIdentity.mockResolvedValue({ id: OTHER_PROFESSOR_ID, name: "Other", email: "x@nus.edu.sg", role: "professor" });
    expect((await call()).status).toBe(403);
    expect(repository.getClass).toHaveBeenCalledWith(CLASS_ID);
    expectNoDataLoaded();
  });

  it("asks a signed-out visitor to sign in", async () => {
    mocks.getIdentity.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("returns 404 for a class that doesn't exist", async () => {
    mocks.getIdentity.mockResolvedValue({ id: ADMIN_ID, name: "Admin", email: "a@nus.edu.sg", role: "admin" });
    expect((await call("missing")).status).toBe(404);
    expectNoDataLoaded();
  });

  it("gives a member professor the zip with a proper file name", async () => {
    mocks.getIdentity.mockResolvedValue({ ...users.prof, id: PROFESSOR_ID, role: "professor" });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="socratic-pilot-CASE-1-PILOT-\d{4}-\d{2}-\d{2}\.zip"/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    expect(Object.keys(zip.files).some((name) => name.endsWith(".xlsx"))).toBe(true);
    expect(repository.getClass.mock.calls).toEqual([[CLASS_ID]]);
    expect(repository.listAssignmentsForClass.mock.calls).toEqual([[CLASS_ID]]);
    expect(repository.listSessionsForAssignments.mock.calls).toEqual([[[ASSIGNMENT_ID]]]);
    for (const name of ["listClasses", "listAssignments", "listSessions"]) expect(repository[name]).not.toHaveBeenCalled();
  });

  it("refuses a class with a student who has no study code, before loading any data", async () => {
    mocks.getIdentity.mockResolvedValue({ id: ADMIN_ID, name: "Admin", email: "a@nus.edu.sg", role: "admin" });
    repository.getClass.mockResolvedValue({ ...teachingClass, members: teachingClass.members.map((member) => member.role === "student" && member.userId === users.r02!.id ? { ...member, user: { ...member.user!, email: "chloe.wong@u.nus.edu" } } : member) });
    const response = await call();
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error).toMatch(/^This class has 1 student without a study code, so the data can't be exported anonymously\./);
    expect(error).not.toMatch(/Chloe|chloe/);
    expectNoDataLoaded();
  });

  it("lets an admin download any class", async () => {
    mocks.getIdentity.mockResolvedValue({ id: ADMIN_ID, name: "Admin", email: "a@nus.edu.sg", role: "admin" });
    expect((await call()).status).toBe(200);
  });

  it("shows a plain message when something goes wrong", async () => {
    mocks.getIdentity.mockResolvedValue({ id: ADMIN_ID, name: "Admin", email: "a@nus.edu.sg", role: "admin" });
    repository.getClass.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await call();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("Couldn't prepare the download. Please try again in a minute.");
  });
});
