// Dev only: creates a test resident (R-TEST) and a test admin on the LOCAL
// Supabase stack, each with a temporary password and the must-change mark.
// Usage: node --env-file=.env.local scripts/dev-create-test-users.mjs
import console from "node:console";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
// Seeded demo class with an open Case 1 assignment, so R-TEST can start a case.
const DEMO_CLASS_ID = "55555555-5555-4555-8555-555555555555";

const TEST_USERS = [
  { email: "r-test@pilot.invalid", displayName: "R-TEST", role: "student", signIn: "R-TEST" },
  { email: "admin-test@example.com", displayName: "Admin Test", role: "admin", signIn: "admin-test@example.com" },
];

function localUrlOrExit(value) {
  let host = "";
  try {
    host = new URL(value ?? "").hostname;
  } catch {
    // Reported below.
  }
  if (!LOCAL_HOSTS.has(host)) {
    console.error("Refusing to run: SUPABASE_URL must point at localhost or 127.0.0.1.");
    process.exit(1);
  }
  return value;
}

const url = localUrlOrExit(process.env.SUPABASE_URL);
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(1);
}
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findAuthUser(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`List auth users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match || data.users.length < 200) return match;
  }
}

async function upsertTestUser({ email, displayName, role }) {
  const password = randomBytes(12).toString("base64url");
  const attributes = { password, email_confirm: true, app_metadata: { must_change_password: true } };
  const existing = await findAuthUser(email);
  const { data, error } = existing
    ? await admin.auth.admin.updateUserById(existing.id, attributes)
    : await admin.auth.admin.createUser({ email, ...attributes });
  if (error || !data.user) throw new Error(`Auth user ${email}: ${error?.message ?? "no user returned"}`);

  const { data: row, error: rowError } = await admin
    .from("users")
    .upsert({ email, display_name: displayName, role, auth_user_id: data.user.id, is_active: true }, { onConflict: "email" })
    .select("id")
    .single();
  if (rowError) throw new Error(`users row ${email}: ${rowError.message}`);
  return { appUserId: row.id, password };
}

const created = [];
for (const user of TEST_USERS) {
  const { appUserId, password } = await upsertTestUser(user);
  if (user.role === "student") {
    const { error } = await admin
      .from("class_memberships")
      .upsert({ class_id: DEMO_CLASS_ID, user_id: appUserId, role: "student", is_lead: false }, { onConflict: "class_id,user_id" });
    if (error) console.warn(`Could not add ${user.displayName} to the demo class: ${error.message}`);
  }
  created.push({ ...user, password });
}

console.log("Local test users (temporary passwords; each must be changed at first sign-in):");
for (const user of created) console.log(`  ${user.role.padEnd(7)} sign in as ${user.signIn.padEnd(24)} password ${user.password}`);
