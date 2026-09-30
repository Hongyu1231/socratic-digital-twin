import { describe, expect, it, vi } from "vitest";
import {
  inspectStoredAttachments,
  normalizeWritableAttachments,
  reportAttachmentDiagnostics,
} from "@/lib/repository/case-attachments";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT_ID = "22222222-2222-4222-8222-222222222222";

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    kind: "image",
    title: "OPG",
    description: "A teaching image.",
    url: "/media/opg.webp",
    ...overrides,
  };
}

describe("persisted case attachment integrity", () => {
  it("keeps stable IDs, omits malformed rows, and reports bounded diagnostics", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = inspectStoredAttachments(CASE_ID, [
      attachment(),
      { id: "not-a-valid-id", title: "PRIVATE_SENTINEL" },
      { ...attachment(), id: undefined, description: "Missing stable ID" },
    ], [1]);
    reportAttachmentDiagnostics(result.diagnostics);

    expect(result.valid).toEqual([expect.objectContaining({ id: ATTACHMENT_ID })]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((item) => item.caseId === CASE_ID && item.reasons.length > 0)).toBe(true);
    expect(JSON.stringify(result.diagnostics)).not.toContain("PRIVATE_SENTINEL");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("treats non-array and over-limit persisted values as invalid", () => {
    expect(inspectStoredAttachments(CASE_ID, { secret: "PRIVATE_SENTINEL" }).diagnostics[0]).toMatchObject({
      caseId: CASE_ID,
      attachmentId: null,
      index: 0,
    });
    const result = inspectStoredAttachments(CASE_ID, Array.from({ length: 13 }, (_, index) => attachment({
      id: `33333333-3333-4${String(index).padStart(3, "0")}-8333-333333333333`,
    })));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 12, reasons: [expect.stringContaining("maximum of 12")] }),
    ]));
    expect(result.valid).toHaveLength(12);
  });

  it("rejects an attachment whose unlock phase is not present", () => {
    const result = inspectStoredAttachments(CASE_ID, [attachment({ unlockPhase: 3 })], [1, 2]);
    expect(result.valid).toHaveLength(0);
    expect(result.diagnostics[0].reasons[0]).toContain("phase not present");
  });

  it("assigns an ID exactly at the write boundary and preserves existing IDs", () => {
    const normalized = normalizeWritableAttachments(CASE_ID, [attachment({ id: undefined })]);
    expect(normalized[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(normalizeWritableAttachments(CASE_ID, [attachment()])[0].id).toBe(ATTACHMENT_ID);
    expect(() => normalizeWritableAttachments(CASE_ID, [attachment(), attachment()])).toThrow(/duplicate media attachment IDs/i);
  });
});

