import process from "node:process";
import { URL } from "node:url";

const productionHosts = new Set([
  "socratic-digital-twin-poc.vercel.app",
  "socratic-digital-twin-poc-hongyu1231s-projects.vercel.app",
  "socratic-digital-twin-poc-git-master-hongyu1231s-projects.vercel.app",
]);

const baseUrl = process.env.E2E_BASE_URL?.trim();
const supabaseUrl = process.env.E2E_SUPABASE_URL?.trim();

if (!baseUrl || !supabaseUrl || process.env.E2E_DATA_ENVIRONMENT !== "test") {
  throw new Error(
    "E2E writes require E2E_BASE_URL, an isolated E2E_SUPABASE_URL, and E2E_DATA_ENVIRONMENT=test.",
  );
}

const target = new URL(baseUrl);
if (productionHosts.has(target.hostname.toLowerCase())) {
  throw new Error(`Refusing to run E2E writes against production host ${target.hostname}.`);
}

if (process.env.PRODUCTION_SUPABASE_URL?.trim() === supabaseUrl) {
  throw new Error("Refusing to run E2E writes against the production Supabase project.");
}

process.stdout.write(`E2E target accepted: ${target.hostname} with an explicitly isolated test datastore.\n`);
