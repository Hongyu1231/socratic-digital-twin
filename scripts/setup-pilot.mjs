// Sets up the resident pilot: staff and resident accounts, one class, one open
// assignment for the published version of a case, and class enrolment.
//
// Usage (dry run by default; prints what it would do):
//   node --env-file=.env.local scripts/setup-pilot.mjs --staff ~/pilot-staff.json --case-id <uuid>
// Options:
//   --codes R01-R14              resident codes: a range like R01-R14 or a list like R01,R02
//   --class-name "Case 1 Resident Pilot"
//   --apply                      make the changes (localhost/127.0.0.1 only, unless --live)
//   --live                       allow a hosted project; asks you to type its project ref
//   --reset-codes R03,R07        give these residents a new password (otherwise never reset)
//
// The staff file is JSON: [{ "name": "...", "email": "...", "role": "professor" | "admin" }].
// The first professor is the class lead. New and reset passwords go to
// ~/socratic-pilot-accounts-<date>.csv (mode 600); only the path is printed.
import console from "node:console";
import { chmodSync, closeSync, existsSync, openSync, readFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, URL } from "node:url";

import { codeToHiddenEmail, generateReadablePassword, validateAccountCode } from "../lib/pilot-accounts.mjs";

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
export const DEFAULTS = Object.freeze({ codes: "R01-R14", className: "Case 1 Resident Pilot" });

export class PilotError extends Error {}

/** Expands "R01-R14" into R01..R14, or splits "R01,R02". Returns uppercase codes. */
export function expandCodes(spec) {
  const value = String(spec ?? "").trim();
  const range = /^([A-Za-z]+)(\d+)-\1?(\d+)$/i.exec(value);
  let codes;
  if (range) {
    const [, prefix, from, to] = range;
    const start = Number(from);
    const end = Number(to);
    if (end < start || end - start > 200) throw new PilotError(`The code range ${value} isn't valid.`);
    codes = Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${String(start + index).padStart(from.length, "0")}`);
  } else {
    codes = value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (!codes.length) throw new PilotError("Give at least one resident code.");
  const checked = codes.map((code) => {
    const result = validateAccountCode(code);
    if (!result.ok) throw new PilotError(`Code "${code}": ${result.error}`);
    return result.code;
  });
  if (new Set(checked).size !== checked.length) throw new PilotError("The resident codes contain a duplicate.");
  return checked;
}

export function parseArgs(argv) {
  const options = { staffPath: "", caseId: "", codes: DEFAULTS.codes, className: DEFAULTS.className, apply: false, live: false, resetCodes: [], help: false };
  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new PilotError(`${flag} needs a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--staff": options.staffPath = takeValue(index, flag); index += 1; break;
      case "--case-id": options.caseId = takeValue(index, flag); index += 1; break;
      case "--codes": options.codes = takeValue(index, flag); index += 1; break;
      case "--class-name": options.className = takeValue(index, flag).trim(); index += 1; break;
      case "--reset-codes": options.resetCodes = expandCodes(takeValue(index, flag)); index += 1; break;
      case "--apply": options.apply = true; break;
      case "--live": options.live = true; break;
      case "--help": case "-h": options.help = true; break;
      default: throw new PilotError(`Unknown option ${flag}. Use --help to see the options.`);
    }
  }
  if (options.help) return options;
  if (!options.staffPath) throw new PilotError("--staff <path to staff JSON> is required.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.caseId)) throw new PilotError("--case-id <case uuid> is required.");
  if (options.className.length < 2 || options.className.length > 120) throw new PilotError("--class-name must be 2 to 120 characters.");
  const codes = expandCodes(options.codes);
  const missing = options.resetCodes.filter((code) => !codes.includes(code));
  if (missing.length) throw new PilotError(`--reset-codes lists codes that aren't in --codes: ${missing.join(", ")}.`);
  return { ...options, codes };
}

/**
 * Decides whether this SUPABASE_URL may be used. Local hosts are always fine.
 * Anything else needs --live, a *.supabase.co host, and the project ref typed
 * back (checked by confirmLive). Applies to dry runs too, since they read data.
 */
export function checkTarget(supabaseUrl, { live }) {
  let host = "";
  try {
    host = new URL(supabaseUrl ?? "").hostname.toLowerCase();
  } catch {
    throw new PilotError("SUPABASE_URL is missing or isn't a valid URL.");
  }
  if (LOCAL_HOSTS.has(host)) return { kind: "local", host };
  if (!live) throw new PilotError(`Refusing to run against ${host}: only localhost or 127.0.0.1 is allowed without --live.`);
  const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (!match) throw new PilotError(`Refusing to run: ${host} isn't a Supabase project host (<ref>.supabase.co).`);
  return { kind: "live", host, ref: match[1] };
}

/** Asks the operator to type the project ref; refuses unless it matches the URL's host. */
export async function confirmLive(target, ask) {
  const typed = String(await ask(`This will use the LIVE project ${target.host}. Type its project ref to confirm: `)).trim();
  if (typed !== target.ref) throw new PilotError("The project ref you typed doesn't match SUPABASE_URL. Nothing was changed.");
}

export function parseStaff(text) {
  let staff;
  try {
    staff = JSON.parse(text);
  } catch {
    throw new PilotError("The staff file isn't valid JSON.");
  }
  if (!Array.isArray(staff) || !staff.length) throw new PilotError("The staff file must be a non-empty list of { name, email, role }.");
  const seen = new Set();
  const result = staff.map((item, index) => {
    const where = `Staff entry ${index + 1}`;
    if (!item || typeof item !== "object") throw new PilotError(`${where} must be { name, email, role }.`);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
    if (!name) throw new PilotError(`${where} needs a name.`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PilotError(`${where} needs a valid email.`);
    if (item.role !== "professor" && item.role !== "admin") throw new PilotError(`${where}: role must be "professor" or "admin".`);
    if (seen.has(email)) throw new PilotError(`${where}: ${email} appears twice.`);
    seen.add(email);
    return { name, email, role: item.role };
  });
  if (!result.some((item) => item.role === "professor")) throw new PilotError("The staff file needs at least one professor (the first one leads the class).");
  return result;
}

/** A class code derived from its name, e.g. "Case 1 Resident Pilot" -> "CASE-1-RESIDENT-PILOT". */
export function classCodeFor(className) {
  return className.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "") || "PILOT";
}

/**
 * Works out every change without writing anything. `store` is read through
 * its find/list methods only.
 */
export async function planPilot(store, options, staff) {
  const notes = [];
  const caseRow = await store.getCase(options.caseId);
  if (!caseRow) throw new PilotError(`No case has the id ${options.caseId}.`);
  const lineageId = caseRow.source_case_id ?? caseRow.id;
  const published = (await store.listCaseLineage(lineageId))
    .filter((row) => row.status === "active")
    .sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0];
  if (!published) throw new PilotError(`"${caseRow.title}" has no published version to assign.`);
  if (published.id !== caseRow.id) notes.push(`Using the published version ${published.version} of "${published.title}" (${published.id}).`);

  const desired = [
    ...staff.map((item) => ({ kind: "staff", code: "", name: item.name, email: item.email, role: item.role })),
    ...options.codes.map((code) => ({ kind: "student", code, name: code, email: codeToHiddenEmail(code), role: "student" })),
  ];
  const usersByEmail = new Map((await store.findUsersByEmail(desired.map((item) => item.email))).map((row) => [row.email.toLowerCase(), row]));
  const authByEmail = await store.findAuthUsersByEmail(desired.map((item) => item.email));

  const accounts = desired.map((item) => {
    const row = usersByEmail.get(item.email);
    const authId = authByEmail.get(item.email) ?? null;
    const wantsReset = item.kind === "student" && options.resetCodes.includes(item.code);
    if (row && row.role !== item.role) notes.push(`${item.code || item.email} already exists as ${row.role}, not ${item.role}; its role is left unchanged.`);
    if (row && row.is_active === false) notes.push(`${item.code || item.email} exists but is deactivated; left as is.`);
    let action;
    if (row?.auth_user_id) action = wantsReset ? "reset" : "skip";
    else if (row) action = authId ? (wantsReset ? "link+reset" : "link") : "create-auth";
    else action = authId ? (wantsReset ? "create-row+reset" : "create-row") : "create";
    return { ...item, action, userId: row?.id ?? null, authUserId: row?.auth_user_id ?? authId, roleMatches: !row || row.role === item.role };
  });

  const classCode = classCodeFor(options.className);
  const classRow = await store.findClassByCode(classCode);
  const assignments = classRow ? await store.listAssignments(classRow.id) : [];
  const otherOpen = assignments.filter((row) => row.status === "open" && row.case_id !== published.id);
  if (otherOpen.length) {
    throw new PilotError(`The class "${classRow.name}" already has another open assignment (case ${otherOpen.map((row) => row.case_id).join(", ")}). Close it in the admin page first, then run this again.`);
  }
  const existingAssignment = assignments.find((row) => row.case_id === published.id);
  if (existingAssignment && existingAssignment.status !== "open") {
    notes.push(`The class already has a ${existingAssignment.status} assignment for this case; it is left ${existingAssignment.status} and no new one is added.`);
  }

  const memberships = classRow ? await store.listMemberships(classRow.id) : [];
  const memberByUser = new Map(memberships.map((row) => [row.user_id, row]));
  const existingLead = memberships.find((row) => row.is_lead) ?? null;
  const lead = accounts.find((item) => item.role === "professor" && item.roleMatches);
  if (!lead) throw new PilotError("No professor in the staff file can lead the class (each one already exists with another role).");
  const enrol = accounts.filter((item) => item.roleMatches && (item.role === "student" || item.role === "professor")).flatMap((item) => {
    const current = item.userId ? memberByUser.get(item.userId) : undefined;
    const makeLead = !existingLead && item === lead;
    if (current) {
      if (current.role !== item.role) notes.push(`${item.code || item.email} is already in the class as ${current.role}; left unchanged.`);
      else if (makeLead) return [{ account: item, role: item.role, isLead: true, update: true }];
      return [];
    }
    return [{ account: item, role: item.role, isLead: makeLead, update: false }];
  });
  if (existingLead && lead && existingLead.user_id !== lead.userId) notes.push("The class already has a lead professor; the lead is left unchanged.");

  return {
    case: { id: published.id, title: published.title, version: published.version ?? 1 },
    accounts,
    teachingClass: classRow ? { id: classRow.id, name: classRow.name, code: classCode, create: false } : { id: null, name: options.className, code: classCode, create: true },
    assignment: existingAssignment ? null : { caseId: published.id },
    enrol,
    leadEmail: lead.email,
    notes,
  };
}

const ACTION_TEXT = {
  create: "create sign-in and user",
  "create-auth": "create sign-in for existing user",
  "create-row": "create user for existing sign-in (password unchanged)",
  "create-row+reset": "create user for existing sign-in and reset password",
  link: "link existing sign-in (password unchanged)",
  "link+reset": "link existing sign-in and reset password",
  reset: "reset password",
};

export function describePlan(plan) {
  const lines = [`Case: "${plan.case.title}" v${plan.case.version} (${plan.case.id})`];
  const changes = plan.accounts.filter((item) => item.action !== "skip");
  const skipped = plan.accounts.length - changes.length;
  for (const item of changes) lines.push(`  account  ${(item.code || item.email).padEnd(28)} ${item.role.padEnd(9)} ${ACTION_TEXT[item.action]}`);
  if (skipped) lines.push(`  ${skipped} account(s) already exist and are left alone`);
  lines.push(plan.teachingClass.create ? `  class    create "${plan.teachingClass.name}" (code ${plan.teachingClass.code})` : `  class    "${plan.teachingClass.name}" already exists`);
  lines.push(plan.assignment ? `  assign   open assignment for "${plan.case.title}"` : "  assign   assignment already exists");
  const leadEntry = plan.enrol.find((item) => item.isLead);
  const adds = plan.enrol.filter((item) => !item.update);
  if (adds.length) lines.push(`  enrol    ${adds.filter((item) => item.role === "student").length} student(s), ${adds.filter((item) => item.role === "professor").length} professor(s)`);
  if (leadEntry) lines.push(`  lead     ${leadEntry.account.email}`);
  if (!adds.length && !leadEntry) lines.push("  enrol    everyone is already enrolled");
  for (const note of plan.notes) lines.push(`  note     ${note}`);
  return lines.join("\n");
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Appends rows to a mode-600 CSV, writing the header when the file is new. */
export function createCsvWriter(filePath) {
  let opened = false;
  return {
    filePath,
    get used() { return opened; },
    append(row) {
      const isNew = !existsSync(filePath);
      const fd = openSync(filePath, "a", 0o600);
      try {
        chmodSync(filePath, 0o600);
        if (isNew) writeSync(fd, "code,name,email,role,password,action,created_at\n");
        writeSync(fd, `${[row.code, row.name, row.email, row.role, row.password, row.action, new Date().toISOString()].map(csvField).join(",")}\n`);
      } finally {
        closeSync(fd);
      }
      opened = true;
    },
  };
}

/** Carries out a plan. Each new password is written to the CSV as soon as it exists. */
export async function applyPlan(store, plan, csv) {
  const ids = new Map();
  for (const item of plan.accounts) {
    let { userId, authUserId } = item;
    let password = null;
    if (item.action === "create" || item.action === "create-auth") {
      password = generateReadablePassword();
      authUserId = await store.createAuthUser(item.email, password);
      try {
        if (item.action === "create") userId = await store.insertUser({ email: item.email, name: item.name, role: item.role, authUserId });
        else await store.linkAuthUser(userId, authUserId);
      } catch (error) {
        await store.deleteAuthUser(authUserId).catch(() => undefined);
        throw error;
      }
    } else if (item.action.startsWith("create-row")) {
      userId = await store.insertUser({ email: item.email, name: item.name, role: item.role, authUserId });
    } else if (item.action.startsWith("link")) {
      await store.linkAuthUser(userId, authUserId);
    }
    if (item.action.endsWith("reset")) {
      password = generateReadablePassword();
      await store.setPassword(authUserId, password);
    }
    if (password) csv.append({ code: item.code, name: item.name, email: item.email, role: item.role, password, action: item.action.endsWith("reset") ? "reset" : "created" });
    ids.set(item.email, userId);
  }

  const owner = ids.get(plan.accounts.find((item) => item.role === "admin")?.email) ?? ids.get(plan.leadEmail);
  const classId = plan.teachingClass.id ?? await store.insertClass({ name: plan.teachingClass.name, code: plan.teachingClass.code, createdBy: owner });

  // Enrol before assigning so the class has its professors from the start.
  const adds = plan.enrol.filter((item) => !item.update);
  if (adds.length) await store.addMemberships(classId, adds.map((item) => ({ userId: ids.get(item.account.email), role: item.role, isLead: item.isLead })));
  for (const item of plan.enrol.filter((entry) => entry.update)) await store.setLead(classId, ids.get(item.account.email));

  if (plan.assignment) await store.insertAssignment({ classId, caseId: plan.assignment.caseId, assignedBy: ids.get(plan.leadEmail) });
  return { classId };
}

/** Data access over a service-role Supabase client. */
export function supabaseStore(client) {
  const must = (result, what) => {
    if (result.error) throw new Error(`${what}: ${result.error.message}`);
    return result.data;
  };
  return {
    async getCase(id) { return must(await client.from("cases").select("id, title, status, version, source_case_id").eq("id", id).maybeSingle(), "Read case"); },
    async listCaseLineage(rootId) { return must(await client.from("cases").select("id, title, status, version, source_case_id").or(`id.eq.${rootId},source_case_id.eq.${rootId}`), "Read case versions"); },
    async findUsersByEmail(emails) { return must(await client.from("users").select("id, email, role, auth_user_id, is_active").in("email", emails), "Read users"); },
    async findAuthUsersByEmail(emails) {
      const wanted = new Set(emails);
      const found = new Map();
      for (let page = 1; ; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(`Read sign-in accounts: ${error.message}`);
        for (const user of data.users) if (user.email && wanted.has(user.email.toLowerCase())) found.set(user.email.toLowerCase(), user.id);
        if (data.users.length < 1000) return found;
      }
    },
    async findClassByCode(code) { return must(await client.from("classes").select("id, name, code").eq("code", code).maybeSingle(), "Read class"); },
    async listAssignments(classId) { return must(await client.from("class_case_assignments").select("id, case_id, status").eq("class_id", classId), "Read assignments"); },
    async listMemberships(classId) { return must(await client.from("class_memberships").select("user_id, role, is_lead").eq("class_id", classId), "Read class members"); },
    async createAuthUser(email, password) {
      const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { must_change_password: true } });
      if (error || !data.user) throw new Error(`Create sign-in for ${email}: ${error?.message ?? "no user returned"}`);
      return data.user.id;
    },
    async deleteAuthUser(id) { must(await client.auth.admin.deleteUser(id), "Remove sign-in"); },
    async setPassword(id, password) { must(await client.auth.admin.updateUserById(id, { password, app_metadata: { must_change_password: true } }), "Reset password"); },
    async insertUser({ email, name, role, authUserId }) {
      return must(await client.from("users").insert({ email, display_name: name, role, auth_user_id: authUserId, is_active: true }).select("id").single(), `Create user ${email}`).id;
    },
    async linkAuthUser(userId, authUserId) { must(await client.from("users").update({ auth_user_id: authUserId }).eq("id", userId), "Link sign-in"); },
    async insertClass({ name, code, createdBy }) {
      return must(await client.from("classes").insert({ name, code, term: `Pilot ${new Date().getFullYear()}`, status: "active", created_by: createdBy }).select("id").single(), "Create class").id;
    },
    async addMemberships(classId, members) {
      must(await client.from("class_memberships").insert(members.map((item) => ({ class_id: classId, user_id: item.userId, role: item.role, is_lead: item.isLead }))), "Enrol class members");
    },
    async setLead(classId, userId) { must(await client.from("class_memberships").update({ is_lead: true }).eq("class_id", classId).eq("user_id", userId), "Set class lead"); },
    async insertAssignment({ classId, caseId, assignedBy }) {
      must(await client.from("class_case_assignments").insert({ class_id: classId, case_id: caseId, assigned_by: assignedBy, status: "open", opens_at: new Date().toISOString(), due_at: null }), "Create assignment");
    },
  };
}

export function csvPathFor(date = new Date()) {
  return path.join(homedir(), `socratic-pilot-accounts-${date.toISOString().slice(0, 10)}.csv`);
}

/** Entry point. `deps` lets tests supply the client factory, prompt and output. */
export async function main(argv, env, deps = {}) {
  const log = deps.log ?? console.log;
  const options = parseArgs(argv);
  if (options.help) {
    log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((line) => line.startsWith("//")).map((line) => line.slice(3)).join("\n"));
    return { mode: "help" };
  }
  const staff = parseStaff(readFileSync(options.staffPath.replace(/^~(?=\/)/, homedir()), "utf8"));
  const target = checkTarget(env.SUPABASE_URL, options);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new PilotError("SUPABASE_SERVICE_ROLE_KEY is not set.");
  if (target.kind === "live") {
    const ask = deps.ask ?? (async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return await rl.question(question); } finally { rl.close(); }
    });
    await confirmLive(target, ask);
  }
  const createClient = deps.createClient ?? (await import("@supabase/supabase-js")).createClient;
  const store = deps.store ?? supabaseStore(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));

  const plan = await planPilot(store, options, staff);
  log(`${options.apply ? "Applying" : "Dry run (nothing is changed; add --apply to run)"} against ${target.host}`);
  log(describePlan(plan));
  if (!options.apply) return { mode: "dry-run", plan };

  const csv = createCsvWriter(deps.csvPath ?? csvPathFor());
  await applyPlan(store, plan, csv);
  log(csv.used ? `Done. New passwords are in ${csv.filePath}` : "Done. No passwords were created or reset, so no file was written.");
  return { mode: "apply", plan, csvPath: csv.used ? csv.filePath : null };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(error instanceof PilotError ? error.message : `Setup stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
