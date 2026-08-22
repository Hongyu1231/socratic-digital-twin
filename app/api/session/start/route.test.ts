import { describe, expect, it, vi } from "vitest";

import { ArchivedCaseError } from "@/lib/repository/types";

const mocks = vi.hoisted(() => ({
  createSessionForAssignment: vi.fn(),
  requireStudent: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", role: "student" })),
}));

vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {},
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/lib/repository", () => ({
  getRepository: () => ({ createSessionForAssignment: mocks.createSessionForAssignment }),
}));

import { POST } from "@/app/api/session/start/route";

describe("start session API", () => {
  it("returns 410 when the assigned case was archived", async () => {
    mocks.createSessionForAssignment.mockRejectedValueOnce(new ArchivedCaseError());

    const response = await POST(new Request("http://localhost/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId: "66666666-6666-4666-8666-666666666666" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "This case is archived and cannot be started.",
      code: "ARCHIVED_CASE",
    });
  });
});
