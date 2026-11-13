export const RESIDENT_EMAIL_DOMAIN: "pilot.invalid";
export function validateAccountCode(input: unknown): { ok: true; code: string } | { ok: false; error: string };
export function codeToHiddenEmail(code: string): string;
export function hiddenEmailToCode(email: unknown): string | null;
