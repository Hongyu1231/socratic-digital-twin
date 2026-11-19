import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCookie: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT ${path}`); }),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ delete: mocks.deleteCookie, getAll: () => [], set: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/auth-client", () => ({ createSupabaseAuthClient: async () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("@/lib/repository", () => ({ getRepository: () => ({}) }));

import { signOut } from "@/app/auth-actions";

beforeEach(() => vi.clearAllMocks());

describe("signOut", () => {
  it("signs out of Supabase, clears the demo cookie and goes to /login", async () => {
    await expect(signOut()).rejects.toThrow("REDIRECT /login");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCookie).toHaveBeenCalledWith("demo_session");
  });

  it("still clears the demo cookie when Supabase sign-out fails", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("down"));
    await expect(signOut()).rejects.toThrow("REDIRECT /login");
    expect(mocks.deleteCookie).toHaveBeenCalledWith("demo_session");
  });
});
