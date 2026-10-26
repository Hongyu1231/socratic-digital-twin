import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/lib/auth";
import type { DemoUser } from "@/lib/domain";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  createUser: vi.fn(),
  getAuthUserId: vi.fn(),
  setAuthUserId: vi.fn(),
  adminClient: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/repository", () => ({
  getRepository: () => ({
    listUsers: mocks.listUsers, updateUser: mocks.updateUser, createUser: mocks.createUser,
    getAuthUserId: mocks.getAuthUserId, setAuthUserId: mocks.setAuthUserId,
  }),
}));
vi.mock("@/lib/supabase/admin-client", () => ({ createSupabaseAdminClient: mocks.adminClient }));

import { GET, PATCH, POST } from "@/app/api/admin/users/route";
import { POST as RESET } from "@/app/api/admin/users/[id]/reset-password/route";

const admin: DemoUser = { id: ADMIN_ID, name: "Admin", email: "admin@example.com", role: "admin", isActive: true };
const student: DemoUser = { id: STUDENT_ID, name: "R05", email: "r05@pilot.invalid", role: "student", isActive: true };

function json(method: string, body: unknown) {
  return new Request("http://localhost/api/admin/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const resetFor = (id: string) => RESET(new Request(`http://localhost/api/admin/users/${id}/reset-password`, { method: "POST" }), { params: Promise.resolve({ id }) });

function fakeAuthClient() {
  return {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: AUTH_ID } }, error: null }),
        updateUserById: vi.fn().mockResolvedValue({ data: { user: { id: AUTH_ID } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
  };
}

describe("admin users API", () => {
  let client: ReturnType<typeof fakeAuthClient>;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    client = fakeAuthClient();
    mocks.adminClient.mockReturnValue(client);
    mocks.requireAdmin.mockResolvedValue(admin);
    mocks.listUsers.mockResolvedValue([admin, student]);
    mocks.updateUser.mockImplementation(async (id: string, patch: object) => ({ ...(id === ADMIN_ID ? admin : student), ...patch }));
    mocks.createUser.mockImplementation(async (input: { name: string; email: string; role: string }) => ({ id: "new-id", isActive: true, ...input }));
    mocks.getAuthUserId.mockResolvedValue(AUTH_ID);
  });

  describe("is admin only", () => {
    for (const [label, status] of [["signed out", 401], ["not an admin", 403]] as const) {
      it(`refuses every action when ${label}`, async () => {
        mocks.requireAdmin.mockRejectedValue(new AuthError(status));
        const responses = await Promise.all([
          GET(), POST(json("POST", { role: "student", code: "R20" })),
          PATCH(json("PATCH", { userId: STUDENT_ID, role: "admin" })), resetFor(STUDENT_ID),
        ]);
        expect(responses.map((response) => response.status)).toEqual([status, status, status, status]);
        expect(mocks.listUsers).not.toHaveBeenCalled();
        expect(mocks.updateUser).not.toHaveBeenCalled();
        expect(client.auth.admin.createUser).not.toHaveBeenCalled();
        expect(client.auth.admin.updateUserById).not.toHaveBeenCalled();
      });
    }
  });

  describe("self protection", () => {
    it("refuses an admin changing their own role", async () => {
      const response = await PATCH(json("PATCH", { userId: ADMIN_ID, role: "professor" }));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("You can't change your own role. Ask another admin to do it.");
      expect(mocks.updateUser).not.toHaveBeenCalled();
    });

    it("refuses an admin deactivating themselves", async () => {
      const response = await PATCH(json("PATCH", { userId: ADMIN_ID, isActive: false }));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/can't deactivate your own account/);
      expect(mocks.updateUser).not.toHaveBeenCalled();
    });

    it("still lets an admin edit their own name, and change someone else's role", async () => {
      expect((await PATCH(json("PATCH", { userId: ADMIN_ID, name: "New Name", role: "admin", isActive: true }))).status).toBe(200);
      const response = await PATCH(json("PATCH", { userId: STUDENT_ID, role: "professor" }));
      expect(response.status).toBe(200);
      expect(mocks.updateUser).toHaveBeenLastCalledWith(STUDENT_ID, { role: "professor" });
    });

    it("rejects an unknown role in plain words", async () => {
      const response = await PATCH(json("PATCH", { userId: STUDENT_ID, role: "owner" }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Choose student, professor or admin.");
    });
  });

  describe("add user", () => {
    it("creates a student from a code with the hidden email and must-change mark, returning the password once", async () => {
      const response = await POST(json("POST", { role: "student", code: "r20" }));
      const body = await response.json();
      expect(response.status).toBe(201);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body.signInAs).toBe("R20");
      expect(body.password).toMatch(/^[a-z]+(-[a-z]+){3}-\d{2}$/);
      expect(client.auth.admin.createUser).toHaveBeenCalledWith({ email: "r20@pilot.invalid", password: body.password, email_confirm: true, app_metadata: { must_change_password: true } });
      expect(mocks.createUser).toHaveBeenCalledWith({ name: "R20", email: "r20@pilot.invalid", role: "student", authUserId: AUTH_ID });
    });

    it("creates staff with name and real email", async () => {
      const response = await POST(json("POST", { role: "professor", name: "Dr Lee", email: "Lee@Example.com" }));
      expect(response.status).toBe(201);
      expect(mocks.createUser).toHaveBeenCalledWith({ name: "Dr Lee", email: "lee@example.com", role: "professor", authUserId: AUTH_ID });
    });

    it("explains bad codes and taken codes in plain words", async () => {
      const bad = await POST(json("POST", { role: "student", code: "R 5!" }));
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toMatch(/2 to 20 characters/);
      const taken = await POST(json("POST", { role: "student", code: "R05" }));
      expect(taken.status).toBe(409);
      expect((await taken.json()).error).toBe("The code R05 is already in use.");
      expect(client.auth.admin.createUser).not.toHaveBeenCalled();
    });

    it("removes the sign-in again if the user row can't be saved", async () => {
      mocks.createUser.mockRejectedValue(new Error("db down"));
      const response = await POST(json("POST", { role: "student", code: "R21" }));
      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/nothing was created/);
      expect(client.auth.admin.deleteUser).toHaveBeenCalledWith(AUTH_ID);
    });
  });

  describe("reset password", () => {
    it("sets a new generated password and the must-change mark", async () => {
      const response = await resetFor(STUDENT_ID);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.signInAs).toBe("R05");
      expect(body.password).toMatch(/^[a-z]+(-[a-z]+){3}-\d{2}$/);
      expect(client.auth.admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { password: body.password, app_metadata: { must_change_password: true } });
    });

    it("creates a sign-in (with the mark) for a user who has none", async () => {
      mocks.getAuthUserId.mockResolvedValue(null);
      const response = await resetFor(STUDENT_ID);
      expect(response.status).toBe(200);
      expect(client.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "r05@pilot.invalid", app_metadata: { must_change_password: true } }));
      expect(mocks.setAuthUserId).toHaveBeenCalledWith(STUDENT_ID, AUTH_ID);
    });

    it("says plainly when the user doesn't exist", async () => {
      const response = await resetFor("22222222-2222-4222-8222-222222222222");
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("That user no longer exists.");
    });
  });
});
