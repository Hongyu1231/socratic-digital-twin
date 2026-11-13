import { describe, expect, it } from "vitest";

import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import { DEMO_STUDENT_ID } from "@/lib/seed";

const AUTH_USER_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

describe("findUserByAuthUserId (memory)", () => {
  it("returns undefined until an auth user is linked, then a copy of the user", async () => {
    const repository = new InMemoryTutorRepository();
    await expect(repository.findUserByAuthUserId(AUTH_USER_ID)).resolves.toBeUndefined();

    repository.linkAuthUser(AUTH_USER_ID, DEMO_STUDENT_ID);
    const user = await repository.findUserByAuthUserId(AUTH_USER_ID);

    expect(user).toMatchObject({ id: DEMO_STUDENT_ID, role: "student" });
    expect(user).not.toHaveProperty("authUserId");
    await expect(repository.findUserByAuthUserId("someone-else")).resolves.toBeUndefined();
  });
});

describe("findUserByAuthUserId (Supabase)", () => {
  function repositoryReturning(result: { data: unknown; error: { message: string } | null }) {
    const calls: unknown[][] = [];
    const builder = {
      select: (...args: unknown[]) => { calls.push(["select", ...args]); return builder; },
      eq: (...args: unknown[]) => { calls.push(["eq", ...args]); return builder; },
      maybeSingle: async () => result,
    };
    const client = { from: (table: string) => { calls.push(["from", table]); return builder; } };
    const repository = Object.create(SupabaseTutorRepository.prototype) as SupabaseTutorRepository;
    Object.defineProperty(repository, "client", { value: client });
    return { repository, calls };
  }

  it("queries users by auth_user_id and maps the row", async () => {
    const { repository, calls } = repositoryReturning({
      data: { id: DEMO_STUDENT_ID, display_name: "Student", email: "s@example.test", role: "student", is_active: true, profile: {}, auth_user_id: AUTH_USER_ID },
      error: null,
    });

    const user = await repository.findUserByAuthUserId(AUTH_USER_ID);

    expect(calls).toContainEqual(["from", "users"]);
    expect(calls).toContainEqual(["eq", "auth_user_id", AUTH_USER_ID]);
    expect(user).toEqual({ id: DEMO_STUDENT_ID, name: "Student", email: "s@example.test", role: "student", isActive: true, profile: {} });
  });

  it("returns undefined when no row matches and throws on a query error", async () => {
    await expect(repositoryReturning({ data: null, error: null }).repository.findUserByAuthUserId(AUTH_USER_ID)).resolves.toBeUndefined();
    await expect(repositoryReturning({ data: null, error: { message: "boom" } }).repository.findUserByAuthUserId(AUTH_USER_ID)).rejects.toThrow("boom");
  });
});
