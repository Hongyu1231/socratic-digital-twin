import type { DemoUser, UserRole } from "@/lib/domain";
import { RESIDENT_EMAIL_DOMAIN } from "@/lib/account-codes.mjs";

/** Residents sign in with a code (R01..R14); each code maps to a hidden email. */
export { RESIDENT_EMAIL_DOMAIN };

/** The one message every failed sign-in shows, whatever the cause. */
export const LOGIN_FAILURE_MESSAGE = "That code or password isn't right.";

export const SET_PASSWORD_PATH = "/set-password";
export const LOGIN_PATH = "/login";
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Input without "@" is a resident code: trimmed, lowercased and given the
 * hidden domain. Input with "@" is an email and is used as given (trimmed).
 */
export function codeOrEmailToEmail(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (value.includes("@")) return value;
  return `${value.toLowerCase()}@${RESIDENT_EMAIL_DOMAIN}`;
}

export function homeForRole(role: UserRole): string {
  return role === "admin" ? "/admin" : role === "professor" ? "/professor" : "/";
}

/** True when Supabase app_metadata says the user must pick a new password. */
export function mustChangePassword(appMetadata: unknown): boolean {
  return Boolean(appMetadata && typeof appMetadata === "object" && (appMetadata as Record<string, unknown>).must_change_password === true);
}

export type SignInDeps = {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: { id: string; app_metadata?: unknown } | null } | null;
    error: unknown;
  }>;
  signOut(): Promise<unknown>;
  findUserByAuthUserId(authUserId: string): Promise<DemoUser | undefined>;
};

export type SignInResult = { ok: true; redirectTo: string } | { ok: false; error: string };

const failure: SignInResult = { ok: false, error: LOGIN_FAILURE_MESSAGE };

/**
 * Signs in with a code or email. Every failure returns the same message so the
 * form never reveals whether a code exists. A Supabase user with no active app
 * user is signed out again.
 */
export async function signInWithCodeOrEmail(input: string, password: string, deps: SignInDeps): Promise<SignInResult> {
  const email = codeOrEmailToEmail(input);
  if (!email || !password) return failure;

  let authUser: { id: string; app_metadata?: unknown } | null | undefined;
  try {
    const { data, error } = await deps.signInWithPassword({ email, password });
    authUser = error ? null : data?.user;
  } catch {
    return failure;
  }
  if (!authUser) return failure;

  let user: DemoUser | undefined;
  try {
    user = await deps.findUserByAuthUserId(authUser.id);
  } catch {
    user = undefined;
  }
  if (!user || user.isActive === false || !["student", "professor", "admin"].includes(user.role)) {
    try {
      await deps.signOut();
    } catch {
      // The failure message is the same either way.
    }
    return failure;
  }

  return { ok: true, redirectTo: mustChangePassword(authUser.app_metadata) ? SET_PASSWORD_PATH : homeForRole(user.role) };
}

export type PageArea = "student" | "professor" | "admin";

/**
 * Where a page guard sends the visitor, or null to let them in. Not signed in
 * goes to /login; a student on staff pages goes home; a professor on /admin
 * goes to /professor; staff on the student home go to their own home.
 */
export function pageGuardRedirect(area: PageArea, role: UserRole | null | undefined): string | null {
  if (!role) return LOGIN_PATH;
  if (area === "student" && role !== "student") return homeForRole(role);
  if (area === "professor" && role === "student") return homeForRole(role);
  if (area === "admin" && role !== "admin") return homeForRole(role);
  return null;
}

/** What middleware does for a user who still carries must_change_password. */
export function passwordChangeAction(pathname: string): "allow" | "redirect" | "forbid" {
  if (pathname === SET_PASSWORD_PATH || pathname === LOGIN_PATH) return "allow";
  if (pathname.startsWith("/_next/") || /\/[^/]+\.[a-z0-9]+$/i.test(pathname)) return "allow";
  return pathname === "/api" || pathname.startsWith("/api/") ? "forbid" : "redirect";
}

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
