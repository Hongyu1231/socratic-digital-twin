import { describe, expect, it, vi } from "vitest";

import type { DemoUser } from "@/lib/domain";
import {
  codeOrEmailToEmail,
  homeForRole,
  LOGIN_FAILURE_MESSAGE,
  pageGuardRedirect,
  passwordChangeAction,
  signInWithCodeOrEmail,
  validateNewPassword,
  type SignInDeps,
} from "@/lib/sign-in";

describe("codeOrEmailToEmail", () => {
  it("turns a resident code into the hidden email", () => {
    expect(codeOrEmailToEmail("R01")).toBe("r01@pilot.invalid");
    expect(codeOrEmailToEmail("  r14 ")).toBe("r14@pilot.invalid");
    expect(codeOrEmailToEmail("R-TEST")).toBe("r-test@pilot.invalid");
  });

  it("uses an email as given", () => {
    expect(codeOrEmailToEmail(" Prof.Lim@nus.edu.sg ")).toBe("Prof.Lim@nus.edu.sg");
  });

  it("returns empty for blank input", () => {
    expect(codeOrEmailToEmail("   ")).toBe("");
  });
});

const student: DemoUser = { id: "app-student", name: "R-TEST", email: "r-test@pilot.invalid", role: "student", isActive: true };

function deps(overrides: Partial<SignInDeps> & { users?: Record<string, { id: string; password: string; app_metadata?: unknown }> } = {}): SignInDeps & { signOut: ReturnType<typeof vi.fn> } {
  const users = overrides.users ?? { "r01@pilot.invalid": { id: "auth-1", password: "correct horse battery" } };
  return {
    signInWithPassword: overrides.signInWithPassword ?? (async ({ email, password }) => {
      const user = users[email];
      return user && user.password === password
        ? { data: { user: { id: user.id, app_metadata: user.app_metadata } }, error: null }
        : { data: { user: null }, error: { message: "Invalid login credentials" } };
    }),
    signOut: vi.fn(async () => undefined),
    findUserByAuthUserId: overrides.findUserByAuthUserId ?? (async (id) => (id === "auth-1" ? student : undefined)),
  };
}

describe("signInWithCodeOrEmail", () => {
  it("shows the same message for a wrong password and an unknown code", async () => {
    const wrongPassword = await signInWithCodeOrEmail("R01", "wrong password!!", deps());
    const unknownCode = await signInWithCodeOrEmail("R99", "correct horse battery", deps());
    expect(wrongPassword).toEqual({ ok: false, error: LOGIN_FAILURE_MESSAGE });
    expect(unknownCode).toEqual(wrongPassword);
    expect(LOGIN_FAILURE_MESSAGE).toBe("That code or password isn't right.");
  });

  it("signs an unlinked or inactive user out again with the same message", async () => {
    for (const findUserByAuthUserId of [async () => undefined, async () => ({ ...student, isActive: false })]) {
      const d = deps({ findUserByAuthUserId });
      expect(await signInWithCodeOrEmail("R01", "correct horse battery", d)).toEqual({ ok: false, error: LOGIN_FAILURE_MESSAGE });
      expect(d.signOut).toHaveBeenCalledTimes(1);
    }
  });

  it("fails with the same message when Auth throws", async () => {
    const d = deps({ signInWithPassword: async () => { throw new Error("down"); } });
    expect(await signInWithCodeOrEmail("R01", "x", d)).toEqual({ ok: false, error: LOGIN_FAILURE_MESSAGE });
  });

  it("redirects by role, or to /set-password when the account carries the mark", async () => {
    expect(await signInWithCodeOrEmail("r01", "correct horse battery", deps())).toEqual({ ok: true, redirectTo: "/" });
    const flagged = deps({ users: { "r01@pilot.invalid": { id: "auth-1", password: "pw", app_metadata: { must_change_password: true } } } });
    expect(await signInWithCodeOrEmail("R01", "pw", flagged)).toEqual({ ok: true, redirectTo: "/set-password" });
    const prof = deps({ users: { "p@nus.edu.sg": { id: "auth-1", password: "pw" } }, findUserByAuthUserId: async () => ({ ...student, role: "professor" }) });
    expect(await signInWithCodeOrEmail("p@nus.edu.sg", "pw", prof)).toEqual({ ok: true, redirectTo: "/professor" });
  });
});

describe("role redirects", () => {
  it("maps each role to its home", () => {
    expect([homeForRole("student"), homeForRole("professor"), homeForRole("admin")]).toEqual(["/", "/professor", "/admin"]);
  });

  it("guards pages by role", () => {
    for (const area of ["student", "professor", "admin"] as const) expect(pageGuardRedirect(area, null)).toBe("/login");
    expect(pageGuardRedirect("professor", "student")).toBe("/");
    expect(pageGuardRedirect("admin", "student")).toBe("/");
    expect(pageGuardRedirect("admin", "professor")).toBe("/professor");
    expect(pageGuardRedirect("admin", "admin")).toBeNull();
    expect(pageGuardRedirect("professor", "professor")).toBeNull();
    expect(pageGuardRedirect("student", "student")).toBeNull();
  });

  it("sends staff on the student home to their own home", () => {
    expect(pageGuardRedirect("student", "professor")).toBe("/professor");
    expect(pageGuardRedirect("student", "admin")).toBe("/admin");
  });
});

describe("passwordChangeAction", () => {
  it("allows the set-password and login pages and static files", () => {
    for (const path of ["/set-password", "/login", "/_next/image", "/og.png", "/favicon.svg"]) expect(passwordChangeAction(path)).toBe("allow");
  });

  it("redirects pages and forbids APIs", () => {
    expect(passwordChangeAction("/")).toBe("redirect");
    expect(passwordChangeAction("/admin")).toBe("redirect");
    expect(passwordChangeAction("/session/abc")).toBe("redirect");
    expect(passwordChangeAction("/api/cases")).toBe("forbid");
  });
});

describe("validateNewPassword", () => {
  it("needs 12 characters and a matching confirmation", () => {
    expect(validateNewPassword("short", "short")).toMatch(/12/);
    expect(validateNewPassword("twelve chars!", "twelve chars?")).toMatch(/match/);
    expect(validateNewPassword("twelve chars!", "twelve chars!")).toBeNull();
  });
});
