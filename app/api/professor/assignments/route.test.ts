import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  requireProfessor: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    role: "professor" as const,
  })),
}));

vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {},
  requireProfessor: mocks.requireProfessor,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: mocks.getRepository,
}));

import { PATCH, POST } from "@/app/api/professor/assignments/route";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import {
  DEMO_CLASS_ID,
  DEMO_PROFESSOR_ID,
  IMPACTED_CANINE_CASE_ID,
} from "@/lib/seed";

describe("professor assignments API", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
    mocks.getRepository.mockReset();
    mocks.getRepository.mockReturnValue(repository);
    mocks.requireProfessor.mockClear();
  });

  async function jsonResponse(response: Response) {
    return response.json() as Promise<Record<string, any>>;
  }

  function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
    return new Request("http://localhost/api/professor/assignments", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("closes and reopens a legacy assignment persisted without a key", async () => {
    const assignment = await repository.saveAssignment({
      classId: DEMO_CLASS_ID,
      caseId: IMPACTED_CANINE_CASE_ID,
      opensAt: "2026-08-09T00:00:00.000+00:00",
      dueAt: null,
      status: "open",
    }, DEMO_PROFESSOR_ID);
    expect(assignment).toMatchObject({
      classId: DEMO_CLASS_ID,
      caseId: IMPACTED_CANINE_CASE_ID,
      status: "open",
      idempotencyKey: null,
      opensAt: "2026-08-09T00:00:00.000+00:00",
    });

    const closeResponse = await PATCH(request("PATCH", {
      assignmentId: assignment.id,
      status: "closed",
    }));
    expect(closeResponse.status).toBe(200);
    expect((await jsonResponse(closeResponse)).assignment).toMatchObject({
      id: assignment.id,
      status: "closed",
      idempotencyKey: null,
      opensAt: "2026-08-09T00:00:00.000+00:00",
    });

    const reopenResponse = await PATCH(request("PATCH", {
      assignmentId: assignment.id,
      status: "open",
    }));
    expect(reopenResponse.status).toBe(200);
    expect((await jsonResponse(reopenResponse)).assignment).toMatchObject({
      id: assignment.id,
      status: "open",
      idempotencyKey: null,
      opensAt: "2026-08-09T00:00:00.000+00:00",
    });
  });

  it("preserves a nonempty idempotency key across status updates", async () => {
    const createResponse = await POST(request("POST", {
      classId: DEMO_CLASS_ID,
      caseId: IMPACTED_CANINE_CASE_ID,
      opensAt: "2026-08-09T00:00:00.000+00:00",
      dueAt: null,
      idempotencyKey: "  assignment:preserve-key  ",
    }));
    const created = await jsonResponse(createResponse);
    const assignment = created.assignment;

    expect(createResponse.status).toBe(200);
    expect(assignment.idempotencyKey).toBe("assignment:preserve-key");

    const closeResponse = await PATCH(request("PATCH", {
      assignmentId: assignment.id,
      status: "closed",
    }));
    expect(closeResponse.status).toBe(200);
    expect((await jsonResponse(closeResponse)).assignment.idempotencyKey).toBe("assignment:preserve-key");
  });

  it("rejects a blank idempotency key", async () => {
    const response = await POST(request("POST", {
      classId: DEMO_CLASS_ID,
      caseId: IMPACTED_CANINE_CASE_ID,
      opensAt: "2026-08-09T00:00:00.000+00:00",
      dueAt: null,
      idempotencyKey: "   ",
    }));

    expect(response.status).toBe(400);
    expect(await jsonResponse(response)).toMatchObject({ error: expect.any(String) });
    expect(await repository.listAssignments(DEMO_PROFESSOR_ID)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ idempotencyKey: "" })]),
    );
  });

  it.each([undefined, null, ""])("rejects a new assignment without a stable key (%s)", async (idempotencyKey) => {
    const save = vi.spyOn(repository, "saveAssignment");
    const response = await POST(request("POST", {
      classId: DEMO_CLASS_ID, caseId: IMPACTED_CANINE_CASE_ID,
      opensAt: "2026-08-09T00:00:00Z", dueAt: null, idempotencyKey,
    }));
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("returns one assignment on retry but permits a deliberate new assignment", async () => {
    const payload = {
      classId: DEMO_CLASS_ID, caseId: IMPACTED_CANINE_CASE_ID,
      opensAt: "2026-08-09T00:00:00Z", dueAt: null, idempotencyKey: "assignment:api-retry",
    };
    const first = await jsonResponse(await POST(request("POST", payload)));
    const retried = await jsonResponse(await POST(request("POST", payload)));
    const next = await jsonResponse(await POST(request("POST", { ...payload, idempotencyKey: "assignment:api-new-intent" })));
    expect(retried.assignment.id).toBe(first.assignment.id);
    expect(next.assignment.id).not.toBe(first.assignment.id);
  });

  it("rejects reusing a creation key with changed details", async () => {
    const payload = {
      classId: DEMO_CLASS_ID, caseId: IMPACTED_CANINE_CASE_ID,
      opensAt: "2026-08-09T00:00:00Z", dueAt: null, idempotencyKey: "assignment:api-conflict",
    };
    await POST(request("POST", payload));
    const changed = await POST(request("POST", { ...payload, dueAt: "2026-10-01T00:00:00Z" }));
    expect(changed.status).toBe(409);
  });
});
