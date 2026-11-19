import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DemoUser } from "@/lib/domain";
import { DEMO_PROFESSOR_ID, DEMO_STUDENT_ID, demoUsers } from "@/lib/seed";

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  createSupabaseAuthClient: vi.fn(),
  getClaims: vi.fn(),
  getSession: vi.fn(),
  findUserByAuthUserId: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "demo_session" && mocks.cookieValue ? { name, value: mocks.cookieValue } : undefined),
    getAll: () => [],
    set: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase/auth-client", () => ({
  createSupabaseAuthClient: mocks.createSupabaseAuthClient,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: () => ({
    findUserByAuthUserId: mocks.findUserByAuthUserId,
    listUsers: mocks.listUsers,
  }),
}));

import {
  AuthError,
  getIdentity,
  isDemoIdentityMode,
  requireAdmin,
  requireProfessor,
  requireStudent,
  signSession,
} from "@/lib/auth";

// One secret for signing and verifying, whatever DEMO_SESSION_SECRET the shell or CI sets.
const TEST_DEMO_SESSION_SECRET = "auth-identity-test-secret";
const AUTH_USER_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const student = demoUsers.find((user) => user.id === DEMO_STUDENT_ID)!;
const professor = demoUsers.find((user) => user.id === DEMO_PROFESSOR_ID)!;

function setEnv(values: { DEMO_IDENTITY_ENABLED?: string; VERCEL?: string; VERCEL_ENV?: string; VERCEL_URL?: string }) {
  for (const name of ["DEMO_IDENTITY_ENABLED", "VERCEL", "VERCEL_ENV", "VERCEL_URL"] as const) {
    vi.stubEnv(name, values[name] ?? "");
  }
  vi.stubEnv("DEMO_SESSION_SECRET", TEST_DEMO_SESSION_SECRET);
}

function signedIn(authUserId: string | null) {
  mocks.getClaims.mockResolvedValue(
    authUserId
      ? { data: { claims: { sub: authUserId, role: "authenticated" } }, error: null }
      : { data: null, error: null },
  );
}

function linkedUser(user: DemoUser | undefined) {
  mocks.findUserByAuthUserId.mockImplementation(async (id: string) => (id === AUTH_USER_ID ? user : undefined));
}

async function expectAuthError(promise: Promise<unknown>, status: 401 | 403) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).status).toBe(status);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieValue = undefined;
  mocks.createSupabaseAuthClient.mockResolvedValue({
    auth: { getClaims: mocks.getClaims, getSession: mocks.getSession },
  });
  mocks.listUsers.mockResolvedValue(demoUsers);
  signedIn(null);
  linkedUser(undefined);
  setEnv({});
});

afterEach(() => vi.unstubAllEnvs());

describe("isDemoIdentityMode", () => {
  it("is on only locally with the flag set to true", () => {
    setEnv({ DEMO_IDENTITY_ENABLED: "true" });
    expect(isDemoIdentityMode()).toBe(true);

    for (const env of [{}, { DEMO_IDENTITY_ENABLED: "1" }, { DEMO_IDENTITY_ENABLED: "true", VERCEL: "1" }, { DEMO_IDENTITY_ENABLED: "true", VERCEL_URL: "x.vercel.app" }]) {
      setEnv(env);
      expect(isDemoIdentityMode()).toBe(false);
    }
  });
});

describe("getIdentity with Supabase Auth", () => {
  it("returns null with no session, and every require* helper fails with 401", async () => {
    await expect(getIdentity()).resolves.toBeNull();
    await expectAuthError(requireStudent(), 401);
    await expectAuthError(requireProfessor(), 401);
    await expectAuthError(requireAdmin(), 401);
    expect(mocks.findUserByAuthUserId).not.toHaveBeenCalled();
  });

  it("returns null when getClaims reports an error", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") });
    await expect(getIdentity()).resolves.toBeNull();
  });

  it("returns null when Supabase Auth is not configured", async () => {
    mocks.createSupabaseAuthClient.mockResolvedValue(null);
    await expect(getIdentity()).resolves.toBeNull();
    await expectAuthError(requireStudent(), 401);
  });

  it("returns null for an auth user with no linked app user", async () => {
    signedIn("11111111-0000-4000-8000-000000000000");
    linkedUser(student);
    await expect(getIdentity()).resolves.toBeNull();
    await expectAuthError(requireStudent(), 401);
  });

  it("returns null for an inactive linked user", async () => {
    signedIn(AUTH_USER_ID);
    linkedUser({ ...student, isActive: false });
    await expect(getIdentity()).resolves.toBeNull();
    await expectAuthError(requireStudent(), 401);
  });

  it("returns the linked active user's id and role", async () => {
    signedIn(AUTH_USER_ID);
    linkedUser(professor);

    const identity = await getIdentity();

    expect(identity).toMatchObject({ id: DEMO_PROFESSOR_ID, role: "professor" });
    await expect(requireProfessor()).resolves.toMatchObject({ id: DEMO_PROFESSOR_ID });
    await expectAuthError(requireStudent(), 403);
    expect(mocks.findUserByAuthUserId).toHaveBeenCalledWith(AUTH_USER_ID);
  });

  it("verifies with getClaims and never getSession", async () => {
    signedIn(AUTH_USER_ID);
    linkedUser(student);
    await getIdentity();
    expect(mocks.getClaims).toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it.each([
    ["the flag is off", {}],
    ["VERCEL is set", { DEMO_IDENTITY_ENABLED: "true", VERCEL: "1" }],
  ])("ignores a valid demo cookie when %s", async (_label, env) => {
    setEnv(env);
    mocks.cookieValue = signSession({ userId: DEMO_PROFESSOR_ID, role: "professor" }, TEST_DEMO_SESSION_SECRET);

    await expect(getIdentity()).resolves.toBeNull();
    await expectAuthError(requireProfessor(), 401);
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
});

describe("getIdentity in local demo mode", () => {
  beforeEach(() => setEnv({ DEMO_IDENTITY_ENABLED: "true" }));

  it("falls back to the seeded student without a cookie", async () => {
    await expect(getIdentity()).resolves.toMatchObject({ id: DEMO_STUDENT_ID, role: "student" });
    expect(mocks.createSupabaseAuthClient).not.toHaveBeenCalled();
  });

  it("uses the signed demo cookie", async () => {
    mocks.cookieValue = signSession({ userId: DEMO_PROFESSOR_ID, role: "professor" }, TEST_DEMO_SESSION_SECRET);
    await expect(requireProfessor()).resolves.toMatchObject({ id: DEMO_PROFESSOR_ID, role: "professor" });
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });
});
