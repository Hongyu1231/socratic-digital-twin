import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIdentity: vi.fn(),
  getSession: vi.fn(),
  listClasses: vi.fn(),
  resolveStudentMediaAttachment: vi.fn(),
}));

vi.mock("@/lib/auth", async () => ({
  ...await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth"),
  getIdentity: mocks.getIdentity,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: () => ({ getSession: mocks.getSession, listClasses: mocks.listClasses }),
}));

vi.mock("@/lib/case-media", async () => {
  const actual = await vi.importActual<typeof import("@/lib/case-media")>("@/lib/case-media");
  return { ...actual, resolveStudentMediaAttachment: mocks.resolveStudentMediaAttachment };
});

import { GET } from "@/app/api/session/[id]/attachments/[attachmentId]/url/route";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";

function sessionBundle(studentId = "66666666-6666-4666-8666-666666666666") {
  return {
    session: { id: SESSION_ID, studentId, caseId: CASE_ID, currentPhase: 1 },
    assignment: { classId: "test-class" },
    case: {
      id: CASE_ID,
      attachments: [{ id: ATTACHMENT_ID, kind: "image", title: "OPG", description: "Teaching image", storagePath: "package/opg.webp" }],
    },
  };
}

function request() {
  return new Request(`http://localhost/api/session/${SESSION_ID}/attachments/${ATTACHMENT_ID}/url`);
}

beforeEach(() => {
  mocks.getIdentity.mockReset();
  mocks.getSession.mockReset();
  mocks.listClasses.mockReset().mockResolvedValue([]);
  mocks.resolveStudentMediaAttachment.mockReset();
  mocks.getIdentity.mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666", role: "student" });
  mocks.getSession.mockResolvedValue(sessionBundle());
  mocks.resolveStudentMediaAttachment.mockResolvedValue({
    attachmentId: ATTACHMENT_ID,
    url: "https://signed.example/opg.webp?token=test",
    expiresAt: "2026-01-01T00:05:00.000Z",
  });
});

describe("private case media URL route", () => {
  it("signs only the requested attachment after ownership validation", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      attachmentId: ATTACHMENT_ID,
      url: "https://signed.example/opg.webp?token=test",
      expiresAt: "2026-01-01T00:05:00.000Z",
    });
    expect(mocks.resolveStudentMediaAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ id: SESSION_ID }) }),
      expect.objectContaining({ id: ATTACHMENT_ID }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not sign another student's session", async () => {
    mocks.getSession.mockResolvedValue(sessionBundle("77777777-7777-4777-8777-777777777777"));
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });

    expect(response.status).toBe(403);
    expect(mocks.resolveStudentMediaAttachment).not.toHaveBeenCalled();
  });

  it("requires an authenticated identity before loading any session", async () => {
    mocks.getIdentity.mockResolvedValue(null);
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });
    expect(response.status).toBe(401);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("signs for a professor only after confirming class membership", async () => {
    mocks.getIdentity.mockResolvedValue({ id: "professor", role: "professor" });
    mocks.listClasses.mockResolvedValue([{ id: "test-class", members: [{ userId: "professor", role: "professor" }] }]);
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });
    expect(response.status).toBe(200);
    expect(mocks.listClasses).toHaveBeenCalledWith("professor");
    expect(mocks.resolveStudentMediaAttachment).toHaveBeenCalledTimes(1);
  });

  it.each([
    { classes: [] },
    { classes: [{ id: "other-class", members: [{ userId: "professor", role: "professor" }] }] },
    { classes: [{ id: "test-class", members: [{ userId: "professor", role: "student" }] }] },
  ])("refuses professors without teaching access to this class (%j)", async ({ classes }) => {
    mocks.getIdentity.mockResolvedValue({ id: "professor", role: "professor" });
    mocks.listClasses.mockResolvedValue(classes);
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });
    expect(response.status).toBe(403);
    expect(mocks.resolveStudentMediaAttachment).not.toHaveBeenCalled();
  });

  it("allows an administrator without loading other students' sessions", async () => {
    mocks.getIdentity.mockResolvedValue({ id: "admin", role: "admin" });
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });
    expect(response.status).toBe(200);
    expect(mocks.listClasses).not.toHaveBeenCalled();
  });

  it("rejects a mismatched session case version before signing", async () => {
    const bundle = sessionBundle();
    bundle.session.caseId = "different-case";
    mocks.getSession.mockResolvedValue(bundle);
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });
    expect(response.status).toBe(404);
    expect(mocks.resolveStudentMediaAttachment).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or malformed attachment id", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: "../../private" }) });

    expect(response.status).toBe(404);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.resolveStudentMediaAttachment).not.toHaveBeenCalled();
  });

  it("returns 404 and never signs when the helper reports a locked attachment", async () => {
    const { CaseMediaError } = await import("@/lib/case-media");
    mocks.resolveStudentMediaAttachment.mockRejectedValueOnce(new CaseMediaError(404, "The teaching attachment is not available yet."));

    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });
    expect(response.status).toBe(404);
    expect(mocks.resolveStudentMediaAttachment).toHaveBeenCalledTimes(1);
    const body = await response.json();
    const missing = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: "99999999-9999-4999-8999-999999999999" }) });
    expect(await missing.json()).toEqual(body);
    expect(missing.headers.get("cache-control")).toBe(response.headers.get("cache-control"));
  });

  it("returns a legacy URL with no expiry when the helper resolves one", async () => {
    mocks.resolveStudentMediaAttachment.mockResolvedValueOnce({ attachmentId: ATTACHMENT_ID, url: "/media/legacy.webp", expiresAt: null });
    const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID, attachmentId: ATTACHMENT_ID }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ url: "/media/legacy.webp", expiresAt: null });
  });
});
