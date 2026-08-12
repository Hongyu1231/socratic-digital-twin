import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import type { DemoUser } from "@/lib/domain";
import {
  DEMO_PROFESSOR_ID,
  DEMO_STUDENT_ID,
  getDemoUser,
} from "@/lib/seed";

export type DemoRole = "student" | "professor" | "admin";

/** The identity shape exposed by the demo auth helpers. */
export type DemoIdentity = Omit<DemoUser, "role"> & { role: DemoRole };

export interface DemoSessionPayload {
  userId: string;
  role: DemoRole;
}

export const DEMO_SESSION_COOKIE_NAME = "demo_session";

/**
 * This fallback is intentionally non-sensitive and only used outside
 * production. A deployment should always provide DEMO_SESSION_SECRET.
 */
export const DEV_DEMO_SESSION_SECRET =
  "demo-session-secret-development-only-change-me";

function getSessionSecret(): string {
  const configuredSecret = process.env.DEMO_SESSION_SECRET?.trim();
  if (configuredSecret) return configuredSecret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("DEMO_SESSION_SECRET must be set in production.");
  }

  return DEV_DEMO_SESSION_SECRET;
}

function encodePayload(payload: DemoSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): DemoSessionPayload | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;

    if (!decoded || typeof decoded !== "object") return null;
    const candidate = decoded as Record<string, unknown>;
    if (typeof candidate.userId !== "string") return null;
    if (candidate.role !== "student" && candidate.role !== "professor" && candidate.role !== "admin") {
      return null;
    }

    return {
      userId: candidate.userId,
      role: candidate.role,
    };
  } catch {
    return null;
  }
}

/**
 * Sign a session payload with HMAC-SHA256. The optional secret makes this
 * helper deterministic and straightforward to exercise in unit tests.
 */
export function signSession(
  payload: DemoSessionPayload,
  secret: string = getSessionSecret(),
): string {
  const encodedPayload = encodePayload(payload);
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify a signed session payload. Invalid, malformed, or tampered values
 * return null rather than throwing so callers can treat them as anonymous.
 */
export function verifySession(
  token: string | null | undefined,
  secret: string = getSessionSecret(),
): DemoSessionPayload | null {
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;

  const encodedPayload = token.slice(0, separator);
  const encodedSignature = token.slice(separator + 1);

  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest();

  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  return decodePayload(encodedPayload);
}

// Descriptive aliases keep the pure signing helpers convenient to consume
// without changing the single canonical implementation above.
export const signDemoSession = signSession;
export const verifyDemoSession = verifySession;

function isDemoIdentity(user: DemoUser | undefined): user is DemoIdentity {
  return (user?.role === "student" || user?.role === "professor" || user?.role === "admin") && user.isActive !== false;
}

function identityForSession(
  session: DemoSessionPayload | null,
): DemoIdentity | null {
  if (!session) return null;

  const user = getDemoUser(session.userId);
  if (!isDemoIdentity(user) || user.role !== session.role) return null;

  // Return a copy so consumers cannot mutate the seeded persona in-process.
  return { ...user };
}

/** Read and verify the current demo identity from the request cookie. */
export async function getIdentity(): Promise<DemoIdentity | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEMO_SESSION_COOKIE_NAME)?.value;
  const verifiedIdentity = identityForSession(verifySession(token));
  const candidate = verifiedIdentity ?? getDemoIdentityForRole("student");
  try {
    const { getRepository } = await import("@/lib/repository");
    const current = (await getRepository().listUsers()).find((user) => user.id === candidate.id);
    if (current && current.role === candidate.role && current.isActive !== false) return { ...current };
    return null;
  } catch {
    return candidate;
  }
  // The POC opens as the seeded student so it is immediately demonstrable.
  // Any explicit role switch is still persisted as a signed HttpOnly cookie.
}

export type AuthErrorStatus = 401 | 403;
export type AuthErrorCode = "unauthenticated" | "forbidden";

/** Error thrown by role guards; route handlers can map `status` to a response. */
export class AuthError extends Error {
  readonly status: AuthErrorStatus;
  readonly statusCode: AuthErrorStatus;
  readonly code: AuthErrorCode;

  constructor(status: AuthErrorStatus, message?: string) {
    const code: AuthErrorCode =
      status === 401 ? "unauthenticated" : "forbidden";
    super(
      message ??
        (status === 401 ? "Authentication is required." : "Forbidden."),
    );
    this.name = "AuthError";
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

async function requireRole(role: DemoRole): Promise<DemoIdentity> {
  const identity = await getIdentity();
  if (!identity) throw new AuthError(401, "Authentication is required.");
  if (identity.role !== role) {
    throw new AuthError(403, `The ${role} role is required.`);
  }
  return identity;
}

export function requireStudent(): Promise<DemoIdentity> {
  return requireRole("student");
}

export function requireProfessor(): Promise<DemoIdentity> {
  return requireRole("professor");
}

export function requireAdmin(): Promise<DemoIdentity> {
  return requireRole("admin");
}

/** Resolve the seeded persona for a role-switch request. */
export function getDemoIdentityForRole(role: DemoRole): DemoIdentity {
  const userId = role === "student" ? DEMO_STUDENT_ID : role === "professor" ? DEMO_PROFESSOR_ID : "99999999-9999-4999-8999-999999999999";
  const user = getDemoUser(userId);
  if (!isDemoIdentity(user)) {
    throw new Error(`Seeded demo ${role} identity is missing.`);
  }
  return { ...user };
}


export function getDemoIdentityForUser(userId: string): DemoIdentity {
  const user = getDemoUser(userId);
  if (!isDemoIdentity(user)) throw new AuthError(403, "This demo identity is unavailable.");
  return { ...user };
}
