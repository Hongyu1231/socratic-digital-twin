import { describe, expect, it } from "vitest";
import { displayDatasetName, formatEnglishDate } from "@/lib/presentation";

describe("feedback lab presentation helpers", () => {
  it("formats ISO dates with a stable English month", () => {
    expect(formatEnglishDate("2026-08-13T20:45:00+08:00")).toBe("13 Aug 2026");
  });

  it("normalizes legacy localized dates into English", () => {
    expect(formatEnglishDate("2026\u5e748\u670813\u65e5")).toBe("13 Aug 2026");
  });

  it("turns protected date tokens into a readable label", () => {
    expect(displayDatasetName("Faculty frozen set <DATE_c85585efa00cd287>")).toBe("Faculty frozen set protected date");
  });
});
