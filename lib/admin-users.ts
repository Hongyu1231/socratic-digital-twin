import type { DemoUser, UserRole } from "@/lib/domain";
import { codeToHiddenEmail, generateReadablePassword, RESIDENT_EMAIL_DOMAIN } from "@/lib/pilot-accounts.mjs";
import type { TutorRepository } from "@/lib/repository/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-client";

/** An admin user-management failure with a plain-words message and HTTP status. */
export class AdminUserError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AdminUserError";
  }
}

/** The Supabase Auth admin calls this module needs (swappable in tests). */
export interface AuthAdmin {
  /** Creates a confirmed user who must change the password; returns its id. */
  createUser(email: string, password: string): Promise<string>;
  /** Sets a new password and the must-change mark. */
  setPassword(authUserId: string, password: string): Promise<void>;
  /** Changes the sign-in email, already confirmed (no email is sent). */
  setEmail(authUserId: string, email: string): Promise<void>;
  deleteUser(authUserId: string): Promise<void>;
}

export function supabaseAuthAdmin(): AuthAdmin | null {
  const client = createSupabaseAdminClient();
  if (!client) return null;
  return {
    async createUser(email, password) {
      const { data, error } = await client.auth.admin.createUser({
        email, password, email_confirm: true, app_metadata: { must_change_password: true },
      });
      if (error || !data.user) throw new Error(error?.message ?? "No user returned.");
      return data.user.id;
    },
    async setPassword(authUserId, password) {
      const { error } = await client.auth.admin.updateUserById(authUserId, {
        password, app_metadata: { must_change_password: true },
      });
      if (error) throw new Error(error.message);
    },
    async setEmail(authUserId, email) {
      const { error } = await client.auth.admin.updateUserById(authUserId, { email, email_confirm: true });
      if (error) throw new Error(error.message);
    },
    async deleteUser(authUserId) {
      const { error } = await client.auth.admin.deleteUser(authUserId);
      if (error) throw new Error(error.message);
    },
  };
}

export type CreateAccountInput =
  | { role: "student"; code: string }
  | { role: "professor" | "admin"; name: string; email: string };

export interface AccountDeps {
  repository: Pick<TutorRepository, "listUsers" | "createUser" | "getAuthUserId" | "setAuthUserId" | "updateUser">;
  auth: AuthAdmin | null;
}

export interface IssuedPassword {
  user: DemoUser;
  /** What the person types on the sign-in page: their code, or their email. */
  signInAs: string;
  password: string;
}

function requireAuth(auth: AuthAdmin | null): AuthAdmin {
  if (!auth) throw new AdminUserError(503, "Accounts can't be managed here because the sign-in service isn't set up.");
  return auth;
}

function isResidentEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${RESIDENT_EMAIL_DOMAIN}`);
}

function signInName(user: Pick<DemoUser, "email">): string {
  return isResidentEmail(user.email) ? user.email.split("@")[0].toUpperCase() : user.email;
}

function looksLikeDuplicate(error: unknown): boolean {
  return error instanceof Error && /already|exists|registered|duplicate|unique/i.test(error.message);
}

function alreadyExists(input: CreateAccountInput): AdminUserError {
  return new AdminUserError(409, input.role === "student"
    ? `The code ${input.code} is already in use.`
    : "An account with this email already exists.");
}

/** Creates the Supabase sign-in account and the linked app user. */
export async function createAccount(input: CreateAccountInput, deps: AccountDeps): Promise<IssuedPassword> {
  const auth = requireAuth(deps.auth);
  const email = input.role === "student" ? codeToHiddenEmail(input.code) : input.email.trim().toLowerCase();
  const name = input.role === "student" ? input.code : input.name.trim();
  const users = await deps.repository.listUsers();
  if (users.some((user) => user.email.toLowerCase() === email)) throw alreadyExists(input);

  const password = generateReadablePassword();
  let authUserId: string;
  try {
    authUserId = await auth.createUser(email, password);
  } catch (error) {
    if (looksLikeDuplicate(error)) throw alreadyExists(input);
    throw new AdminUserError(502, "The sign-in account could not be created. Please try again.");
  }

  try {
    const user = await deps.repository.createUser({ name, email, role: input.role, authUserId });
    return { user, signInAs: input.role === "student" ? input.code : email, password };
  } catch {
    // Undo the sign-in account so a retry starts clean.
    await auth.deleteUser(authUserId).catch(() => undefined);
    throw new AdminUserError(500, "The account could not be saved, so nothing was created. Please try again.");
  }
}

/**
 * Gives the user a new generated password and the must-change mark. A user
 * with no sign-in account yet gets one.
 */
export async function resetPassword(userId: string, deps: AccountDeps): Promise<IssuedPassword> {
  const auth = requireAuth(deps.auth);
  const user = (await deps.repository.listUsers()).find((item) => item.id === userId);
  if (!user) throw new AdminUserError(404, "That user no longer exists.");
  const password = generateReadablePassword();
  const failed = () => new AdminUserError(502, "The password could not be reset. Please try again.");
  const existingAuthUserId = await deps.repository.getAuthUserId(userId);
  if (existingAuthUserId) {
    try {
      await auth.setPassword(existingAuthUserId, password);
    } catch {
      throw failed();
    }
    return { user, signInAs: signInName(user), password };
  }

  let newAuthUserId: string;
  try {
    newAuthUserId = await auth.createUser(user.email, password);
  } catch {
    throw failed();
  }
  try {
    await deps.repository.setAuthUserId(userId, newAuthUserId);
  } catch {
    // Remove the unlinked sign-in so a retry can create it again.
    try {
      await auth.deleteUser(newAuthUserId);
    } catch {
      throw new AdminUserError(500, `The password could not be reset, and the half-made sign-in for ${user.email} could not be removed. Ask a developer to remove it in Supabase before trying again.`);
    }
    throw failed();
  }
  return { user, signInAs: signInName(user), password };
}

export interface UserUpdate {
  userId: string;
  name?: string;
  email?: string;
  isActive?: boolean;
  role?: UserRole;
}

/**
 * Profile, status and role changes. An admin can't demote or deactivate
 * themselves. A resident's email is fixed to their code. A staff email change
 * goes to the sign-in account first, then the user row; if the row can't be
 * saved, the sign-in email is put back.
 */
export async function updateAccount(actor: Pick<DemoUser, "id" | "role">, update: UserUpdate, deps: AccountDeps): Promise<DemoUser> {
  const { userId, ...patch } = update;
  if (userId === actor.id) {
    if (patch.role !== undefined && patch.role !== actor.role) throw new AdminUserError(403, "You can't change your own role. Ask another admin to do it.");
    if (patch.isActive === false) throw new AdminUserError(403, "You can't deactivate your own account. Ask another admin to do it.");
  }
  const users = await deps.repository.listUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) throw new AdminUserError(404, "That user no longer exists.");

  const newEmail = patch.email?.trim().toLowerCase();
  delete patch.email;
  if (newEmail === undefined || newEmail === user.email.toLowerCase()) return deps.repository.updateUser(userId, patch);

  if (isResidentEmail(user.email)) throw new AdminUserError(400, "A resident signs in with their code, so their email can't be changed.");
  if (isResidentEmail(newEmail)) throw new AdminUserError(400, `Addresses ending in @${RESIDENT_EMAIL_DOMAIN} are reserved for resident codes.`);
  const taken = () => new AdminUserError(409, "Another account already uses this email.");
  if (users.some((item) => item.id !== userId && item.email.toLowerCase() === newEmail)) throw taken();

  const withEmail = { ...patch, email: newEmail };
  const authUserId = await deps.repository.getAuthUserId(userId);
  if (!authUserId) return deps.repository.updateUser(userId, withEmail);

  const auth = requireAuth(deps.auth);
  try {
    await auth.setEmail(authUserId, newEmail);
  } catch (error) {
    if (looksLikeDuplicate(error)) throw taken();
    throw new AdminUserError(502, "The sign-in email could not be changed, so nothing was changed. Please try again.");
  }
  try {
    return await deps.repository.updateUser(userId, withEmail);
  } catch {
    try {
      await auth.setEmail(authUserId, user.email);
    } catch {
      throw new AdminUserError(500, `The change could not be saved, and the sign-in email could not be put back. ${user.name} now signs in with ${newEmail}, but the user list still shows ${user.email}. Try saving again, or ask a developer to fix it.`);
    }
    throw new AdminUserError(500, "The change could not be saved, so nothing was changed. Please try again.");
  }
}
