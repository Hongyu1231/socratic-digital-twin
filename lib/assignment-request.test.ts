import { describe, expect, it, vi } from "vitest";
import { assignmentRequest } from "./assignment-request";

const payload = { classId: "class", caseId: "case", opensAt: "2026-09-30T00:00:00.000Z", dueAt: null };

describe("assignment creation intent", () => {
  it("reuses the same payload and key after an ambiguous failed response", () => {
    const key = vi.fn(() => "assignment:retry-key");
    const first = assignmentRequest(null, payload, key);
    expect(assignmentRequest(first, { ...payload }, key)).toBe(first);
    expect(key).toHaveBeenCalledTimes(1);
  });

  it("starts a new intent for edited details, without mutating the old request", () => {
    const first = assignmentRequest(null, payload, () => "assignment:first");
    const next = assignmentRequest(first, { ...payload, dueAt: "2026-10-31T00:00:00.000Z" }, () => "assignment:second");
    expect(next.idempotencyKey).toBe("assignment:second");
    expect(first.dueAt).toBeNull();
  });

  it("allows deliberately assigning the same case again after success or cancellation", () => {
    const first = assignmentRequest(null, payload, () => "assignment:first");
    const next = assignmentRequest(null, payload, () => "assignment:second");
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
