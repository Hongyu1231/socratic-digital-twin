import { describe, expect, it } from "vitest";
import { buildCaseVersionSlug, getNextCaseVersion, getVersionedCaseTitle } from "@/lib/repository/case-version";

describe("case version helpers", () => {
  it("builds stable unique slugs for separate cloned rows", () => {
    const first = buildCaseVersionSlug("Impacted Maxillary Canine v2", 2, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const second = buildCaseVersionSlug("Impacted Maxillary Canine v2", 2, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^impacted-maxillary-canine-v2-v2-[a-f0-9]{32}$/);
  });

  it("increments from the highest version in the complete lineage", () => {
    const cases = [
      { id: "root", sourceCaseId: null, version: 1 },
      { id: "v2", sourceCaseId: "root", version: 2 },
      { id: "v3", sourceCaseId: "root", version: 3 },
      { id: "other", sourceCaseId: null, version: 9 },
    ];

    expect(getNextCaseVersion(cases, cases[0])).toBe(4);
    expect(getNextCaseVersion(cases, cases[1])).toBe(4);
    expect(getVersionedCaseTitle("Impacted Maxillary Canine v2", 4)).toBe("Impacted Maxillary Canine v4");
  });
});
