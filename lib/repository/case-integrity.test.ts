import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { DEMO_ADMIN_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";

describe("repository case integrity boundary", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
  });

  it("hides invalid stored attachments from learner output but keeps admin diagnostics", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = (repository as unknown as { store: { cases: Map<string, any> } }).store;
    const current = store.cases.get(IMPACTED_CANINE_CASE_ID);
    store.cases.set(IMPACTED_CANINE_CASE_ID, {
      ...current,
      attachments: [{ kind: "image", title: "Corrupt", description: "PRIVATE_CONTENT", url: "/corrupt.svg" }],
    });

    const learnerCase = await repository.getCase(IMPACTED_CANINE_CASE_ID);
    expect(learnerCase?.attachments).toEqual([]);
    const adminView = await repository.listCaseVersionsWithDiagnostics();
    expect(adminView.diagnostics).toEqual([expect.objectContaining({ caseId: IMPACTED_CANINE_CASE_ID, attachmentId: null })]);
    expect(JSON.stringify(adminView.diagnostics)).not.toContain("PRIVATE_CONTENT");
    expect(warn).toHaveBeenCalled();

    await expect(repository.saveCase({ ...current, status: "draft" }, DEMO_ADMIN_ID)).rejects.toThrow(/invalid stored attachments/i);
    await expect(repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID)).rejects.toThrow(/invalid stored attachments/i);
    warn.mockRestore();
  });

  it("does not create a replacement when saving a missing explicit case ID", async () => {
    const currentCases = await repository.listCaseVersions();
    const missingId = "99999999-9999-4999-8999-999999999999";
    await expect(repository.saveCase({ ...currentCases[0], id: missingId, status: "draft" }, DEMO_ADMIN_ID))
      .rejects.toThrow(/case not found/i);
    expect((await repository.listCaseVersions()).some((item) => item.id === missingId)).toBe(false);
  });
});
