"use client";

import { useActionState, useId } from "react";
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
  const errorId = `${useId()}-error`;
  // Hide the old error while a new attempt runs, so the same message is
  // added again afterwards and screen readers read it out each time.
  const error = pending ? null : state.error;
  return (
    <form action={formAction} className="auth-form" noValidate>
      {fields.map((field) => (
        <label key={field.name}>
          <span>{field.label}</span>
          <input
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            minLength={field.minLength}
            required
            aria-describedby={error ? errorId : undefined}
          />
        </label>
      ))}
      {error ? <p id={errorId} className="auth-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}
        {submitLabel}
      </button>
    </form>
  );
}
