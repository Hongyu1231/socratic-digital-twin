import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publishCase: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/repository", () => ({ getRepository: () => ({ publishCase: mocks.publishCase }) }));

import { POST } from "@/app/api/admin/cases/[id]/publish/route";

describe("admin case publication API", () => {
  beforeEach(() => {
    mocks.publishCase.mockReset().mockResolvedValue({ id: "case-1", status: "available" });
    mocks.requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  });

  it("moves open assignments by default", async () => {
    const response = await POST(new Request("http://localhost/api/admin/cases/case-1/publish", { method: "POST" }), { params: Promise.resolve({ id: "case-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.publishCase).toHaveBeenCalledWith("case-1", true);
  });

  it("passes the explicit keep-open-assignment choice", async () => {
    const response = await POST(new Request("http://localhost/api/admin/cases/case-1/publish", {
      method: "POST",
      body: JSON.stringify({ moveOpenAssignments: false }),
    }), { params: Promise.resolve({ id: "case-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.publishCase).toHaveBeenCalledWith("case-1", false);
  });

  it("rejects a non-boolean assignment option", async () => {
    const response = await POST(new Request("http://localhost/api/admin/cases/case-1/publish", {
      method: "POST",
      body: JSON.stringify({ moveOpenAssignments: "false" }),
    }), { params: Promise.resolve({ id: "case-1" }) });
    expect(response.status).toBe(400);
    expect(mocks.publishCase).not.toHaveBeenCalled();
  });
});
