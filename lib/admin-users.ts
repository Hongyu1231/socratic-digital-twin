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

function signInName(user: Pick<DemoUser, "email">): string {
  const [local, domain] = user.email.split("@");
  return domain === RESIDENT_EMAIL_DOMAIN ? local.toUpperCase() : user.email;
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
    if (error instanceof Error && /already|exists|registered/i.test(error.message)) throw alreadyExists(input);
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
  const authUserId = await deps.repository.getAuthUserId(userId);
  try {
    if (authUserId) {
      await auth.setPassword(authUserId, password);
    } else {
      await deps.repository.setAuthUserId(userId, await auth.createUser(user.email, password));
    }
  } catch {
    throw new AdminUserError(502, "The password could not be reset. Please try again.");
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

/** Profile, status and role changes. An admin can't demote or deactivate themselves. */
export async function updateAccount(actor: Pick<DemoUser, "id" | "role">, update: UserUpdate, deps: Pick<AccountDeps, "repository">): Promise<DemoUser> {
  const { userId, ...patch } = update;
  if (userId === actor.id) {
    if (patch.role !== undefined && patch.role !== actor.role) throw new AdminUserError(403, "You can't change your own role. Ask another admin to do it.");
    if (patch.isActive === false) throw new AdminUserError(403, "You can't deactivate your own account. Ask another admin to do it.");
  }
  const exists = (await deps.repository.listUsers()).some((user) => user.id === userId);
  if (!exists) throw new AdminUserError(404, "That user no longer exists.");
  return deps.repository.updateUser(userId, patch);
}
