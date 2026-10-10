import { describe, expect, it } from "vitest";
import { remainingTutorRequestMs, startTutorRequestBudget, tutorProviderTimeout } from "@/lib/tutor/request-budget";

describe("shared tutor request budget", () => {
  it("reserves ten seconds before the 45-second client deadline", () => {
    expect(startTutorRequestBudget(1_000)).toBe(36_000);
  });
  it("caps the first call and gives the second only remaining time", () => {
    const deadline = startTutorRequestBudget(0);
    expect(remainingTutorRequestMs(deadline, 25_000, 5_000)).toBe(25_000);
    expect(remainingTutorRequestMs(deadline, 25_000, 28_000)).toBe(7_000);
  });
  it("skips optional generation with less than one second left", () => {
    expect(remainingTutorRequestMs(35_000, 25_000, 34_001)).toBe(0);
    expect(remainingTutorRequestMs(35_000, 25_000, 40_000)).toBe(0);
  });
  it("honours a smaller caller cap", () => expect(remainingTutorRequestMs(35_000, 4_000, 0)).toBe(4_000));
  it("keeps the standalone adapter deadline but caps oversized timeouts", () => {
    expect(tutorProviderTimeout()).toBe(25_000);
    expect(tutorProviderTimeout(90_000)).toBe(25_000);
    expect(tutorProviderTimeout(3_001.8)).toBe(3_001);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects exhausted/invalid budget %s", (timeout) => {
    expect(() => tutorProviderTimeout(timeout)).toThrow("budget is exhausted");
  });
});
