import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listStudentOfferings: vi.fn(),
  requireStudent: vi.fn(async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    role: "student",
  })),
}));

vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {},
  requireStudent: mocks.requireStudent,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: () => ({
    mode: "supabase",
    listStudentOfferings: mocks.listStudentOfferings,
  }),
}));

import { GET } from "@/app/api/cases/route";

describe("student cases API", () => {
  beforeEach(() => {
    mocks.listStudentOfferings.mockReset();
  });

  it("returns one identity-scoped catalogue copy with private no-store caching", async () => {
    const offerings = [{
      assignment: { id: "assignment-1" },
      case: { id: "case-1", title: "Teaching case" },
    }];
    mocks.listStudentOfferings.mockResolvedValueOnce(offerings);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(body).toEqual({ offerings });
    expect(body).not.toHaveProperty("cases");
    expect(body).not.toHaveProperty("storage");
    expect(mocks.listStudentOfferings).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });
});
