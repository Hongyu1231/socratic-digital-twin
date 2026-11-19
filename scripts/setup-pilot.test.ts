import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { checkTarget, classCodeFor, confirmLive, expandCodes, main, parseArgs, parseStaff } from "./setup-pilot.mjs";

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const dir = mkdtempSync(path.join(tmpdir(), "pilot-test-"));
const staffPath = path.join(dir, "staff.json");
writeFileSync(staffPath, JSON.stringify([
  { name: "Ada Admin", email: "ada@example.com", role: "admin" },
  { name: "Prof Lead", email: "lead@example.com", role: "professor" },
]));
const baseArgs = ["--staff", staffPath, "--case-id", CASE_ID];
const LOCAL_ENV = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "test-key" };

const WRITES = ["createAuthUser", "deleteAuthUser", "setPassword", "insertUser", "linkAuthUser", "insertClass", "addMemberships", "setLead", "insertAssignment"] as const;

/** An in-memory store; writes record into `state` so re-runs can be checked. */
function memoryStore(opts: { forbidWrites?: boolean } = {}) {
  const state = {
    cases: [{ id: CASE_ID, title: "Impacted canine", status: "active", version: 1, source_case_id: null }],
    users: [] as Array<{ id: string; email: string; role: string; auth_user_id: string | null; is_active: boolean }>,
    auth: new Map<string, string>(),
    classes: [] as Array<{ id: string; name: string; code: string }>,
    assignments: [] as Array<{ id: string; class_id: string; case_id: string; status: string }>,
    members: [] as Array<{ class_id: string; user_id: string; role: string; is_lead: boolean }>,
    passwords: new Map<string, string>(),
  };
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const store: Record<string, (...args: any[]) => Promise<any>> = {
    getCase: async (caseId) => state.cases.find((row) => row.id === caseId) ?? null,
    listCaseLineage: async (root) => state.cases.filter((row) => row.id === root || row.source_case_id === root),
    findUsersByEmail: async (emails: string[]) => state.users.filter((row) => emails.includes(row.email)),
    findAuthUsersByEmail: async (emails: string[]) => new Map([...state.auth].filter(([email]) => emails.includes(email))),
    findClassByCode: async (code) => state.classes.find((row) => row.code === code) ?? null,
    listAssignments: async (classId) => state.assignments.filter((row) => row.class_id === classId),
    listMemberships: async (classId) => state.members.filter((row) => row.class_id === classId),
    createAuthUser: async (email, password) => { const authId = id(); state.auth.set(email, authId); state.passwords.set(authId, password); return authId; },
    deleteAuthUser: async () => undefined,
    setPassword: async (authId, password) => { state.passwords.set(authId, password); },
    insertUser: async ({ email, role, authUserId }) => { const userId = id(); state.users.push({ id: userId, email, role, auth_user_id: authUserId, is_active: true }); return userId; },
    linkAuthUser: async (userId, authId) => { state.users.find((row) => row.id === userId)!.auth_user_id = authId; },
    insertClass: async ({ name, code }) => { const classId = id(); state.classes.push({ id: classId, name, code }); return classId; },
    addMemberships: async (classId, members) => { for (const m of members) state.members.push({ class_id: classId, user_id: m.userId, role: m.role, is_lead: m.isLead }); },
    setLead: async (classId, userId) => { state.members.find((row) => row.class_id === classId && row.user_id === userId)!.is_lead = true; },
    insertAssignment: async ({ classId, caseId }) => { state.assignments.push({ id: id(), class_id: classId, case_id: caseId, status: "open" }); },
  };
  if (opts.forbidWrites) for (const name of WRITES) store[name] = vi.fn(async () => { throw new Error(`dry run wrote via ${name}`); });
  return { store, state };
}

describe("setup-pilot arguments", () => {
  it("defaults to a dry run with R01-R14 and the pilot class name", () => {
    const options = parseArgs(baseArgs);
    expect(options.apply).toBe(false);
    expect(options.live).toBe(false);
    expect(options.codes).toEqual(Array.from({ length: 14 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`));
    expect(options.className).toBe("Case 1 Resident Pilot");
    expect(classCodeFor(options.className)).toBe("CASE-1-RESIDENT-PILOT");
  });

  it("validates codes, reset codes and required options", () => {
    expect(expandCodes("r01,R02")).toEqual(["R01", "R02"]);
    expect(() => expandCodes("R01,R 2")).toThrow(/2 to 20 characters/);
    expect(() => parseArgs([...baseArgs, "--reset-codes", "R20"])).toThrow(/aren't in --codes/);
    expect(parseArgs([...baseArgs, "--reset-codes", "R03,R07"]).resetCodes).toEqual(["R03", "R07"]);
    expect(() => parseArgs(["--case-id", CASE_ID])).toThrow(/--staff/);
    expect(() => parseArgs(["--staff", staffPath])).toThrow(/--case-id/);
    expect(() => parseArgs([...baseArgs, "--bogus"])).toThrow(/Unknown option/);
  });

  it("checks the staff file and needs a professor", () => {
    expect(() => parseStaff("[]")).toThrow(/non-empty/);
    expect(() => parseStaff(JSON.stringify([{ name: "A", email: "a@x.org", role: "admin" }]))).toThrow(/at least one professor/);
    expect(() => parseStaff(JSON.stringify([{ name: "A", email: "a@x.org", role: "student" }]))).toThrow(/role must be/);
  });
});

describe("setup-pilot target guard", () => {
  it("allows localhost and 127.0.0.1", () => {
    expect(checkTarget("http://127.0.0.1:54321", { live: false }).kind).toBe("local");
    expect(checkTarget("http://localhost:54321", { live: false }).kind).toBe("local");
  });

  it("refuses any other host without --live", () => {
    expect(() => checkTarget("https://abcdefghijklmnop.supabase.co", { live: false })).toThrow(/only localhost or 127.0.0.1/);
    expect(() => checkTarget("http://192.168.1.5:54321", { live: false })).toThrow(/only localhost/);
    expect(() => checkTarget("", { live: false })).toThrow(/isn't a valid URL/);
  });

  it("with --live, needs a supabase.co host and the matching ref typed back", async () => {
    expect(() => checkTarget("https://example.com", { live: true })).toThrow(/isn't a Supabase project host/);
    const target = checkTarget("https://abcdefghijklmnop.supabase.co", { live: true });
    expect(target).toEqual({ kind: "live", host: "abcdefghijklmnop.supabase.co", ref: "abcdefghijklmnop" });
    await expect(confirmLive(target, async () => "wrongref")).rejects.toThrow(/doesn't match/);
    await expect(confirmLive(target, async () => " abcdefghijklmnop ")).resolves.toBeUndefined();
  });

  it("refuses a hosted URL before connecting, even for a dry run", async () => {
    const createClient = vi.fn();
    await expect(main(baseArgs, { ...LOCAL_ENV, SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" }, { createClient, log: () => undefined })).rejects.toThrow(/only localhost/);
    const ask = vi.fn(async () => "nope");
    await expect(main([...baseArgs, "--live", "--apply"], { ...LOCAL_ENV, SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" }, { createClient, ask, log: () => undefined })).rejects.toThrow(/doesn't match/);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("setup-pilot runs", () => {
  it("dry run reads only and prints the plan", async () => {
    const { store } = memoryStore({ forbidWrites: true });
    const lines: string[] = [];
    const result = await main(baseArgs, LOCAL_ENV, { store, log: (line: string) => lines.push(line), csvPath: path.join(dir, "never.csv") });
    expect(result.mode).toBe("dry-run");
    for (const name of WRITES) expect(store[name]).not.toHaveBeenCalled();
    const output = lines.join("\n");
    expect(output).toMatch(/Dry run/);
    expect(output).toMatch(/R14\s+student\s+create sign-in and user/);
    expect(output).toMatch(/class\s+create "Case 1 Resident Pilot"/);
    expect(output).toMatch(/enrol\s+14 student\(s\), 1 professor\(s\)/);
    expect(output).toMatch(/lead\s+lead@example.com/);
    expect(() => statSync(path.join(dir, "never.csv"))).toThrow();
  });

  it("applies once, writes a mode-600 CSV, and a re-run creates nothing", async () => {
    const { store, state } = memoryStore();
    const csvPath = path.join(dir, "accounts.csv");
    const lines: string[] = [];
    await main([...baseArgs, "--apply"], LOCAL_ENV, { store, log: (line: string) => lines.push(line), csvPath });
    expect(state.users).toHaveLength(16);
    expect(state.classes).toHaveLength(1);
    expect(state.assignments).toEqual([expect.objectContaining({ case_id: CASE_ID, status: "open" })]);
    expect(state.members.filter((row) => row.role === "student")).toHaveLength(14);
    expect(state.members.filter((row) => row.is_lead)).toEqual([expect.objectContaining({ role: "professor" })]);
    expect(state.members.some((row) => state.users.find((user) => user.id === row.user_id)?.role === "admin")).toBe(false);
    expect(statSync(csvPath).mode & 0o777).toBe(0o600);
    const csv = readFileSync(csvPath, "utf8").trim().split("\n");
    expect(csv).toHaveLength(17);
    expect(csv[1]).toMatch(/^,Ada Admin,ada@example.com,admin,[a-z]+(-[a-z]+){3}-\d{2},created,/);
    const passwords = [...state.passwords.values()];
    expect(lines.join("\n")).not.toContain(passwords[0]);
    expect(lines.at(-1)).toBe(`Done. New passwords are in ${csvPath}`);

    const before = JSON.stringify({ ...state, auth: [...state.auth], passwords: [...state.passwords] });
    const again: string[] = [];
    const rerun = await main([...baseArgs, "--apply"], LOCAL_ENV, { store, log: (line: string) => again.push(line), csvPath });
    expect(JSON.stringify({ ...state, auth: [...state.auth], passwords: [...state.passwords] })).toBe(before);
    expect(rerun.csvPath).toBeNull();
    expect(again.join("\n")).toMatch(/16 account\(s\) already exist/);
    expect(readFileSync(csvPath, "utf8").trim().split("\n")).toHaveLength(17);
  });

  it("resets only the codes named in --reset-codes", async () => {
    const { store, state } = memoryStore();
    const csvPath = path.join(dir, "reset.csv");
    await main([...baseArgs, "--apply"], LOCAL_ENV, { store, log: () => undefined, csvPath });
    const before = new Map(state.passwords);
    await main([...baseArgs, "--apply", "--reset-codes", "R03,R07"], LOCAL_ENV, { store, log: () => undefined, csvPath });
    const changed = [...state.passwords].filter(([authId, password]) => before.get(authId) !== password).map(([authId]) => [...state.auth].find(([, id]) => id === authId)?.[0]);
    expect(changed.sort()).toEqual(["r03@pilot.invalid", "r07@pilot.invalid"]);
    const resetRows = readFileSync(csvPath, "utf8").trim().split("\n").filter((line) => line.includes(",reset,"));
    expect(resetRows.map((line) => line.split(",")[0])).toEqual(["R03", "R07"]);
  });

  it("refuses a class that already has a different open assignment", async () => {
    const { store, state } = memoryStore();
    state.classes.push({ id: "c1", name: "Case 1 Resident Pilot", code: "CASE-1-RESIDENT-PILOT" });
    state.assignments.push({ id: "a1", class_id: "c1", case_id: "other-case", status: "open" });
    await expect(main(baseArgs, LOCAL_ENV, { store, log: () => undefined })).rejects.toThrow(/already has another open assignment/);
  });

  it("assigns the published version when given an older one", async () => {
    const { store, state } = memoryStore();
    state.cases[0].status = "superseded";
    state.cases.push({ id: "44444444-4444-4444-8444-444444444444", title: "Impacted canine v2", status: "active", version: 2, source_case_id: CASE_ID as never });
    await main([...baseArgs, "--apply"], LOCAL_ENV, { store, log: () => undefined, csvPath: path.join(dir, "v2.csv") });
    expect(state.assignments.map((row) => row.case_id)).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });

  it("refuses the whole plan when an unlinked user has another role, before any write", async () => {
    const { store, state } = memoryStore();
    state.users.push({ id: "u-admin", email: "r01@pilot.invalid", role: "admin", auth_user_id: null, is_active: true });
    for (const name of WRITES) store[name] = vi.fn(store[name]);
    const error = await main([...baseArgs, "--apply"], LOCAL_ENV, { store, log: () => undefined, csvPath: path.join(dir, "mismatch.csv") }).catch((reason) => reason);
    expect(error.message).toMatch(/Nothing was changed/);
    expect(error.message).toMatch(/R01: r01@pilot\.invalid already belongs to an admin account that has no sign-in yet, but this plan wants a student/);
    for (const name of WRITES) expect(store[name]).not.toHaveBeenCalled();
    expect(state.users).toHaveLength(1);
    expect(state.users[0].auth_user_id).toBeNull();
    expect(() => statSync(path.join(dir, "mismatch.csv"))).toThrow();
  });

  it("refuses --reset-codes for a linked user with another role, and lists every mismatch", async () => {
    const { store, state } = memoryStore();
    await main([...baseArgs, "--apply"], LOCAL_ENV, { store, log: () => undefined, csvPath: path.join(dir, "reset-mismatch.csv") });
    state.users.find((row) => row.email === "r03@pilot.invalid")!.role = "professor";
    state.users.find((row) => row.email === "lead@example.com")!.role = "admin";
    const before = new Map(state.passwords);
    for (const name of WRITES) store[name] = vi.fn(store[name]);
    const error = await main([...baseArgs, "--apply", "--reset-codes", "R03"], LOCAL_ENV, { store, log: () => undefined, csvPath: path.join(dir, "reset-mismatch.csv") }).catch((reason) => reason);
    expect(error.message).toMatch(/lead@example\.com: lead@example\.com already belongs to an admin account that has a sign-in, but this plan wants a professor/);
    expect(error.message).toMatch(/R03 \(listed in --reset-codes\): r03@pilot\.invalid already belongs to a professor account that has a sign-in, but this plan wants a student/);
    for (const name of WRITES) expect(store[name]).not.toHaveBeenCalled();
    expect(state.passwords).toEqual(before);
  });
});
