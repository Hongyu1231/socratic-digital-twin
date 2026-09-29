// Temporary shared-password gate for the whole site until real accounts exist.
// Runs in the Edge runtime, so it uses only Web APIs (atob, TextEncoder,
// crypto.subtle) and never node:crypto.

export const SITE_GATE_REALM = "Socratic Digital Twin";

export type SiteGateEnv = {
  SITE_GATE_PASSWORD?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
};

export type SiteGateMode =
  | { kind: "enforce"; password: string }
  | { kind: "locked" }
  | { kind: "open" };

// Any Vercel system variable counts as "on Vercel". The gate can only be off
// when all of them are absent and no password is configured, so there is no
// variable a deployment could set to disable it.
export function isVercelDeployment(env: SiteGateEnv): boolean {
  return Boolean(env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL);
}

export function resolveSiteGateMode(env: SiteGateEnv): SiteGateMode {
  const password = env.SITE_GATE_PASSWORD;
  if (password) return { kind: "enforce", password };
  return isVercelDeployment(env) ? { kind: "locked" } : { kind: "open" };
}

// Decodes a Basic Authorization header to its "username:password" text.
export function decodeBasicCredentials(header: string | null): string | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match) return null;
  try {
    const binary = atob(match[1]);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

// The username is ignored so users can type anything there, including a
// colon: the credentials pass when they end with ":" followed by the password.
export async function credentialsMatch(credentials: string, expected: string): Promise<boolean> {
  const tail = credentials.slice(-(expected.length + 1));
  // Always hash, so a too-short input does not return measurably faster.
  const matched = await passwordsMatch(tail.slice(1), expected);
  return matched && tail.length === expected.length + 1 && tail[0] === ":";
}

// Hashing both sides first gives fixed-length inputs, so the comparison time
// depends on neither the password's length nor where the first mismatch is.
export async function passwordsMatch(supplied: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function unauthorizedResponse(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${SITE_GATE_REALM}"`,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export function lockedResponse(): Response {
  return new Response("This site is locked because SITE_GATE_PASSWORD is not configured.", {
    status: 503,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Returns null when the request may continue, otherwise the response to send.
export async function checkSiteGate(
  authorization: string | null,
  env: SiteGateEnv,
): Promise<Response | null> {
  const mode = resolveSiteGateMode(env);
  if (mode.kind === "open") return null;
  if (mode.kind === "locked") return lockedResponse();
  const credentials = decodeBasicCredentials(authorization);
  if (credentials === null) return unauthorizedResponse();
  return (await credentialsMatch(credentials, mode.password)) ? null : unauthorizedResponse();
}
