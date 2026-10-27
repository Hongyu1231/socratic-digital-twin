// Resident codes and their hidden sign-in emails. No Node-only imports, so the
// browser, middleware and plain Node scripts can all use it.

/** Residents sign in with a code (R01..R14); each code maps to a hidden email. */
export const RESIDENT_EMAIL_DOMAIN = "pilot.invalid";

const CODE_PATTERN = /^[A-Za-z0-9-]{2,20}$/;

/**
 * Checks a resident code. Returns the uppercase code, or an error in plain words.
 * @param {unknown} input
 * @returns {{ ok: true, code: string } | { ok: false, error: string }}
 */
export function validateAccountCode(input) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return { ok: false, error: "Enter a code." };
  if (!CODE_PATTERN.test(value)) return { ok: false, error: "A code must be 2 to 20 characters: letters, digits and hyphens only." };
  return { ok: true, code: value.toUpperCase() };
}

/** The hidden sign-in email for a resident code (lowercased). */
export function codeToHiddenEmail(code) {
  return `${code.trim().toLowerCase()}@${RESIDENT_EMAIL_DOMAIN}`;
}
