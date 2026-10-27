import { describe, expect, it, vi } from "vitest";

const randomInt = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  randomInt.mockImplementation((...args: unknown[]) => (actual.randomInt as (...a: unknown[]) => number)(...args));
  return { ...actual, randomInt, default: { ...actual, randomInt } };
});

import { codeToHiddenEmail, generateReadablePassword, PASSWORD_WORDS, validateAccountCode } from "@/lib/pilot-accounts.mjs";

describe("generateReadablePassword", () => {
  it("embeds at least 500 short, unique, lowercase words", () => {
    expect(PASSWORD_WORDS.length).toBeGreaterThanOrEqual(500);
    expect(new Set(PASSWORD_WORDS).size).toBe(PASSWORD_WORDS.length);
    for (const word of PASSWORD_WORDS) expect(word).toMatch(/^[a-z]{2,8}$/);
  });

  it("is four list words and two digits joined by hyphens", () => {
    for (let index = 0; index < 50; index += 1) {
      const password = generateReadablePassword();
      expect(password).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
      const parts = password.split("-");
      for (const word of parts.slice(0, 4)) expect(PASSWORD_WORDS).toContain(word);
      expect(password.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("draws every part from crypto.randomInt", () => {
    randomInt.mockClear();
    generateReadablePassword();
    expect(randomInt).toHaveBeenCalledTimes(5);
    expect(randomInt.mock.calls.slice(0, 4)).toEqual(Array(4).fill([PASSWORD_WORDS.length]));
    expect(randomInt.mock.calls[4]).toEqual([100]);
  });

  it("follows the random source exactly (no other randomness)", () => {
    randomInt.mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3).mockReturnValueOnce(7);
    expect(generateReadablePassword()).toBe(`${PASSWORD_WORDS.slice(0, 4).join("-")}-07`);
  });

  it("does not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateReadablePassword()));
    expect(seen.size).toBe(200);
  });
});

describe("validateAccountCode", () => {
  it("accepts 2-20 letters, digits and hyphens and returns it uppercase", () => {
    expect(validateAccountCode("r05")).toEqual({ ok: true, code: "R05" });
    expect(validateAccountCode("  r-test ")).toEqual({ ok: true, code: "R-TEST" });
    expect(validateAccountCode("AB")).toEqual({ ok: true, code: "AB" });
    expect(validateAccountCode("A".repeat(20))).toEqual({ ok: true, code: "A".repeat(20) });
  });

  it("rejects empty, too short, too long and other characters in plain words", () => {
    expect(validateAccountCode("")).toEqual({ ok: false, error: "Enter a code." });
    for (const bad of ["R", "A".repeat(21), "R 05", "R_05", "r05@x", "R05!", "é1"]) {
      const result = validateAccountCode(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/2 to 20 characters/);
    }
    expect(validateAccountCode(undefined).ok).toBe(false);
  });

  it("maps a code to the hidden sign-in email", () => {
    expect(codeToHiddenEmail("R05")).toBe("r05@pilot.invalid");
  });
});
