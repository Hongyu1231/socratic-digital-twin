import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { setPassword } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { LOGIN_PATH, MIN_PASSWORD_LENGTH } from "@/lib/sign-in";
import { createSupabaseAuthClient } from "@/lib/supabase/auth-client";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage() {
  const supabase = await createSupabaseAuthClient();
  const { data, error } = supabase ? await supabase.auth.getClaims() : { data: null, error: null };
  if (error || !data?.claims?.sub) redirect(LOGIN_PATH);

  return (
    <section className="auth-page">
      <h1>Set your password</h1>
      <p>Choose a new password of at least {MIN_PASSWORD_LENGTH} characters before you continue.</p>
      <AuthForm
        action={setPassword}
        submitLabel="Save password"
        fields={[
          { name: "password", label: "New password", type: "password", autoComplete: "new-password", minLength: MIN_PASSWORD_LENGTH },
          { name: "confirm", label: "Confirm new password", type: "password", autoComplete: "new-password", minLength: MIN_PASSWORD_LENGTH },
        ]}
      />
    </section>
  );
}
