import type { Metadata } from "next";

import { signIn } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <section className="auth-page">
      <h1>Sign in</h1>
      <p>Residents use their code (for example R01). Staff use their email.</p>
      <AuthForm
        action={signIn}
        submitLabel="Sign in"
        fields={[
          { name: "identifier", label: "Code or email", type: "text", autoComplete: "username" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
    </section>
  );
}
