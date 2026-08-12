import { describe, expect, it } from "vitest";

import {
  signSession,
  verifySession,
  type DemoSessionPayload,
} from "@/lib/auth";

describe("demo session signing", () => {
  const secret = "unit-test-demo-session-secret";
  const payload: DemoSessionPayload = {
    userId: "11111111-1111-4111-8111-111111111111",
    role: "student",
  };

  it("round-trips a signed payload", () => {
    const token = signSession(payload, secret);

    expect(verifySession(token, secret)).toEqual(payload);
  });

  it("rejects a token whose payload or signature was changed", () => {
    const token = signSession(payload, secret);
    const [encodedPayload, encodedSignature] = token.split(".");
    const tamperedPayload = `${encodedPayload.slice(0, -1)}${
      encodedPayload.endsWith("a") ? "b" : "a"
    }.${encodedSignature}`;

    expect(verifySession(tamperedPayload, secret)).toBeNull();
    expect(
      verifySession(`${encodedPayload}.${encodedSignature.slice(0, -1)}a`, secret),
    ).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession(payload, secret);

    expect(verifySession(token, "another-secret")).toBeNull();
  });
});
