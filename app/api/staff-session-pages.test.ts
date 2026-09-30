import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listStaffSessions: vi.fn(),
  listSessions: vi.fn(),
  listSessionsForProfessor: vi.fn(),
  requireProfessor: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", role: "professor" })),
  requireAdmin: vi.fn(async () => ({ role: "admin" })),
}));
vi.mock("@/lib/auth", () => ({ AuthError: class extends Error {}, requireProfessor: mocks.requireProfessor, requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/repository", () => ({ getRepository: () => mocks }));
import { GET as professorGET } from "./professor/sessions/route";
import { GET as adminGET } from "./admin/sessions/route";

describe("bounded staff session pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listStaffSessions.mockResolvedValue({ sessions: [], nextCursor: null, stats: { total: 0 }, assignmentProgress: {} });
  });

  it("scopes professor pages before querying and never hydrates the full queue", async () => {
    const response = await professorGET(new Request("http://localhost/api/professor/sessions?limit=10&reviewFilter=mine"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listStaffSessions).toHaveBeenCalledWith({ limit: 10, reviewFilter: "mine" }, "22222222-2222-4222-8222-222222222222");
    expect(mocks.listSessionsForProfessor).not.toHaveBeenCalled();
  });

  it("supports admin class filtering and forwards opaque cursors", async () => {
    const classId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await adminGET(new Request(`http://localhost/api/admin/sessions?classId=${classId}&cursor=opaque-cursor`));
    expect(mocks.listStaffSessions).toHaveBeenCalledWith({ limit: 25, classId, cursor: "opaque-cursor", reviewFilter: "all" });
    expect(mocks.listSessions).not.toHaveBeenCalled();
  });

  it.each(["limit=1000", "limit=0", "limit=", "limit=NaN", "classId=invalid", "reviewFilter=unrestricted"])("rejects unsafe pagination (%s)", async (query) => {
    expect((await professorGET(new Request(`http://localhost/api/professor/sessions?${query}`))).status).toBe(400);
    expect(mocks.listStaffSessions).not.toHaveBeenCalled();
  });
});
