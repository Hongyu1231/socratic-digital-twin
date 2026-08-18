import { beforeEach, describe, expect, it, vi } from "vitest";

import { demoUsers, DEMO_ADMIN_ID } from "@/lib/seed";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  getIdentity: vi.fn(),
  listUsers: vi.fn(),
  signSession: vi.fn(() => "signed-session"),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet }),
}));

vi.mock("@/lib/auth", () => ({
  DEMO_SESSION_COOKIE_NAME: "demo_session",
  getIdentity: mocks.getIdentity,
  signSession: mocks.signSession,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: () => ({ listUsers: mocks.listUsers }),
}));

import { GET, POST } from "@/app/api/demo/identity/route";

describe("demo identity API", () => {
  beforeEach(() => {
    mocks.cookieSet.mockClear();
    mocks.signSession.mockClear();
    mocks.listUsers.mockResolvedValue(demoUsers);
    mocks.getIdentity.mockResolvedValue(demoUsers[0]);
  });

  it("returns only id, name, and role for seeded active identities", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.users).toHaveLength(6);
    expect(body.users[0]).toEqual({
      id: demoUsers[0].id,
      name: demoUsers[0].name,
      role: demoUsers[0].role,
    });
    expect(JSON.stringify(body)).not.toContain("@u.nus.edu");
    expect(body.identity).not.toHaveProperty("email");
    expect(body.identity).not.toHaveProperty("profile");
  });

  it("allows an explicitly seeded admin identity without returning its profile", async () => {
    const response = await POST(new Request("http://localhost/api/demo/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: DEMO_ADMIN_ID }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.identity).toEqual({
      id: DEMO_ADMIN_ID,
      name: "Dr. Elaine Koh",
      role: "admin",
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "demo_session",
      "signed-session",
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
    );
  });

  it("rejects an active database user who is not in the seeded allowlist", async () => {
    const outsiderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mocks.listUsers.mockResolvedValue([
      ...demoUsers,
      { id: outsiderId, name: "Not seeded", email: "hidden@example.test", role: "admin", isActive: true },
    ]);

    const response = await POST(new Request("http://localhost/api/demo/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: outsiderId }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
