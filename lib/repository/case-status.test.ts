import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { assertCaseStatusTransition, CASE_STATUS_TRANSITIONS } from "@/lib/repository/case-status";
import { DEMO_ADMIN_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";

describe("case publication transition contract", () => {
  let repository: InMemoryTutorRepository;

  beforeEach(() => {
    repository = new InMemoryTutorRepository();
    repository.reset();
  });

  it("keeps a single explicit allowlist for publish, supersede, and archive", () => {
    expect(CASE_STATUS_TRANSITIONS.publish).toEqual(["draft"]);
    expect(CASE_STATUS_TRANSITIONS.archive).toEqual(["draft", "active"]);
    expect(CASE_STATUS_TRANSITIONS.supersede).toEqual(["active"]);
    expect(() => assertCaseStatusTransition("publish", "active")).toThrow(/already published/i);
    expect(() => assertCaseStatusTransition("archive", "archived")).toThrow(/already archived/i);
    expect(() => assertCaseStatusTransition("supersede", "superseded")).toThrow(/already superseded/i);
  });

  it("returns conflicts for repeated publication and archive, and 404-style errors for unknown IDs", async () => {
    await expect(repository.publishCase("missing-case")).rejects.toThrow(/case not found/i);
    await expect(repository.publishCase(IMPACTED_CANINE_CASE_ID)).rejects.toThrow(/already published/i);

    const draft = await repository.cloneCase(IMPACTED_CANINE_CASE_ID, DEMO_ADMIN_ID);
    await repository.archiveCase(draft.id);
    await expect(repository.archiveCase(draft.id)).rejects.toThrow(/already archived/i);
  });
});
