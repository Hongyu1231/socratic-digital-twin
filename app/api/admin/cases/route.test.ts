import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCaseVersionsWithDiagnostics: vi.fn(),
  requireAdmin: vi.fn(),
  getCase: vi.fn(),
  saveCase: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: () => ({
    listCaseVersionsWithDiagnostics: mocks.listCaseVersionsWithDiagnostics,
    getCase: mocks.getCase,
    saveCase: mocks.saveCase,
  }),
}));

import { GET, POST } from "@/app/api/admin/cases/route";

describe("admin cases API", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset();
    mocks.listCaseVersionsWithDiagnostics.mockReset();
    mocks.getCase.mockReset();
    mocks.saveCase.mockReset();
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

  it("passes extras through the validated save path instead of dropping them", async () => {
    const input = {
      title: "Synthetic feedback case", description: "Synthetic teaching case only.", difficulty: "advanced",
      learningObjectives: ["Explain a required observation"],
      phases: [{ order: 1, title: "Observe", goal: "Reason using supplied records.",
        rubric: [{ id: "required", text: "Required observation" }],
        acceptedExtras: [{ id: "bonus", text: "Optional parallax discussion" }],
        starterQuestion: "What do you notice?", exampleQuestions: ["What supports that observation?"] }],
    };
    mocks.saveCase.mockImplementationOnce(async (value) => value);
    const response = await POST(new Request("http://localhost/api/admin/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
    expect(response.status).toBe(200);
    expect(mocks.saveCase.mock.calls[0][0].phases[0].acceptedExtras).toEqual(input.phases[0].acceptedExtras);
    expect(mocks.saveCase.mock.calls[0][0].phases[0].rubric).toHaveLength(1);
  });
});
