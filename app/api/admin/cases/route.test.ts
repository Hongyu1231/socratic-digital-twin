import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCaseVersionsWithDiagnostics: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: () => ({
    listCaseVersionsWithDiagnostics: mocks.listCaseVersionsWithDiagnostics,
  }),
}));

import { GET } from "@/app/api/admin/cases/route";

describe("admin cases API", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset();
    mocks.listCaseVersionsWithDiagnostics.mockReset();
    mocks.requireAdmin.mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
  });

  it("returns cases and bounded attachment diagnostics only to admins", async () => {
    const cases = [{ id: "case-1", title: "Teaching case", attachments: [] }];
    const diagnostics = [{
      caseId: "case-1",
      attachmentId: null,
      index: 0,
      reasons: ["id: stored attachments must have a stable ID"],
    }];
    mocks.listCaseVersionsWithDiagnostics.mockResolvedValueOnce({ cases, diagnostics });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ cases, diagnostics });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.listCaseVersionsWithDiagnostics).toHaveBeenCalledTimes(1);
  });
});
