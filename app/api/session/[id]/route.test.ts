import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIdentity: vi.fn(), getSession: vi.fn(), listClasses: vi.fn(),
  prepareStudentMedia: vi.fn(), studentResponse: vi.fn(),
}));
vi.mock("@/lib/auth", async () => ({
  ...await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth"),
  getIdentity: mocks.getIdentity,
}));
vi.mock("@/lib/repository", () => ({ getRepository: () => mocks }));
vi.mock("@/lib/case-media", () => ({ prepareStudentMedia: mocks.prepareStudentMedia }));
vi.mock("@/lib/student-response", () => ({ studentResponse: mocks.studentResponse }));

import { GET } from "./route";

const bundle = {
  session: { id: "session", caseId: "case-v1", studentId: "student", evaluations: [{ feedback: "Faculty feedback" }] },
  assignment: { classId: "class" },
  case: { id: "case-v1", attachments: [{ id: "image", storagePath: "private/key.webp", url: "https://old-public.example/image" }] },
};
const read = () => GET(new Request("http://localhost/api/session/session"), { params: Promise.resolve({ id: "session" }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getIdentity.mockResolvedValue({ id: "prof", role: "professor" });
  mocks.getSession.mockResolvedValue(bundle);
  mocks.listClasses.mockResolvedValue([{ id: "class", members: [{ userId: "prof", role: "professor" }] }]);
  mocks.prepareStudentMedia.mockResolvedValue([{ id: "image", url: "https://signed.example/image" }]);
  mocks.studentResponse.mockResolvedValue(Response.json({ student: true }));
});

describe("session read authorization and private media", () => {
  it.each(["professor", "admin"])("returns signed media, not storage keys, to %s", async (role) => {
    mocks.getIdentity.mockResolvedValue({ id: "prof", role });
    const response = await read();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.session.evaluations).toEqual(bundle.session.evaluations);
    expect(body.case.attachments).toEqual([{ id: "image", url: "https://signed.example/image" }]);
    expect(JSON.stringify(body)).not.toContain("private/key");
    expect(JSON.stringify(body)).not.toContain("old-public.example");
    expect(mocks.prepareStudentMedia).toHaveBeenCalledWith(bundle);
  });

  it("never signs when a professor is outside the class", async () => {
    mocks.listClasses.mockResolvedValue([]);
    expect((await read()).status).toBe(403);
    expect(mocks.prepareStudentMedia).not.toHaveBeenCalled();
  });

  it("keeps the student response privacy boundary", async () => {
    mocks.getIdentity.mockResolvedValue({ id: "student", role: "student" });
    const response = await read();
    expect(await response.json()).toEqual({ student: true });
    expect(mocks.studentResponse).toHaveBeenCalledWith(bundle);
  });
});
