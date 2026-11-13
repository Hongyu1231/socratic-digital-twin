"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DEMO_SESSION_COOKIE_NAME, getIdentity } from "@/lib/auth";
import { getRepository } from "@/lib/repository";
import { homeForRole, LOGIN_PATH, signInWithCodeOrEmail, validateNewPassword } from "@/lib/sign-in";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-client";
import { createSupabaseAuthClient } from "@/lib/supabase/auth-client";

export type FormState = { error: string | null };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createSupabaseAuthClient();
  const result = await signInWithCodeOrEmail(field(formData, "identifier"), field(formData, "password"), {
    signInWithPassword: (credentials) => supabase ? supabase.auth.signInWithPassword(credentials) : Promise.reject(new Error("Auth is not configured.")),
    signOut: () => supabase ? supabase.auth.signOut() : Promise.resolve(),
    findUserByAuthUserId: (authUserId) => getRepository().findUserByAuthUserId(authUserId),
  });
  if (!result.ok) return { error: result.error };
  redirect(result.redirectTo);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseAuthClient();
  try {
    await supabase?.auth.signOut();
  } catch {
    // Clear the local cookies below regardless.
  }
  (await cookies()).delete(DEMO_SESSION_COOKIE_NAME);
  redirect(LOGIN_PATH);
}

export async function setPassword(_state: FormState, formData: FormData): Promise<FormState> {
  const password = field(formData, "password");
  const problem = validateNewPassword(password, field(formData, "confirm"));
  if (problem) return { error: problem };

  const supabase = await createSupabaseAuthClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return { error: "Password changes are not available right now." };

  const { data, error: claimsError } = await supabase.auth.getClaims();
  const authUserId = claimsError ? undefined : data?.claims?.sub;
  const identity = await getIdentity();
  if (typeof authUserId !== "string" || !identity) redirect(LOGIN_PATH);

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.code === "same_password" ? "Choose a password different from your current one." : "Your password could not be changed. Try again." };
  }

  const { error: clearError } = await admin.auth.admin.updateUserById(authUserId, { app_metadata: { must_change_password: false } });
  if (clearError) return { error: "Your password was changed, but the change could not be finished. Try again." };

  // The new access token no longer carries the flag.
  await supabase.auth.refreshSession();
  redirect(homeForRole(identity.role));
}
