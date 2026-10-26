import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Keep the real isDemoIdentityMode so the env rules are exercised.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getIdentity: mocks.getIdentity,
  signSession: mocks.signSession,
}));

function setDemoEnv(values: { DEMO_IDENTITY_ENABLED?: string; VERCEL?: string; VERCEL_ENV?: string; VERCEL_URL?: string }) {
  for (const name of ["DEMO_IDENTITY_ENABLED", "VERCEL", "VERCEL_ENV", "VERCEL_URL"] as const) {
    vi.stubEnv(name, values[name] ?? "");
  }
}

function postSwitch(userId: string) {
  return POST(new Request("http://localhost/api/demo/identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  }));
}

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
    setDemoEnv({ DEMO_IDENTITY_ENABLED: "true" });
  });
  afterEach(() => vi.unstubAllEnvs());

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

describe("demo identity API outside demo mode", () => {
  beforeEach(() => {
    mocks.cookieSet.mockClear();
    mocks.listUsers.mockClear();
    mocks.listUsers.mockResolvedValue(demoUsers);
    mocks.getIdentity.mockResolvedValue(demoUsers[0]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["the flag is off", { DEMO_IDENTITY_ENABLED: "false" }],
    ["the flag is missing", {}],
    ["VERCEL is set", { DEMO_IDENTITY_ENABLED: "true", VERCEL: "1" }],
    ["only VERCEL_ENV is set", { DEMO_IDENTITY_ENABLED: "true", VERCEL_ENV: "preview" }],
  ])("returns 404 for GET and POST when %s", async (_label, env) => {
    setDemoEnv(env);

    const getResponse = await GET();
    const postResponse = await postSwitch(DEMO_ADMIN_ID);

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
