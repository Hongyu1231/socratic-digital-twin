"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";

import type { FormState } from "@/app/auth-actions";

type Field = { name: string; label: string; type: "text" | "password"; autoComplete: string; minLength?: number };

export function AuthForm({
  action,
  fields,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: Field[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="auth-form" noValidate>
      {fields.map((field) => (
        <label key={field.name}>
          <span>{field.label}</span>
          <input name={field.name} type={field.type} autoComplete={field.autoComplete} minLength={field.minLength} required />
        </label>
      ))}
      {state.error ? <p className="auth-error" role="alert">{state.error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="spin" /> : null}
        {submitLabel}
      </button>
    </form>
  );
}
