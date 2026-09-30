import { describe, expect, it, vi } from "vitest";

import { SupabaseTutorRepository } from "@/lib/repository/supabase";

const TUTOR_PROJECT_REF = "zulvdacbqvmqmtotyeuc";
const shouldRun = process.env.RUN_SUPABASE_PREFLIGHT === "true";

function projectRefFromUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Supabase preflight requires SUPABASE_URL to be a valid HTTPS project URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Supabase preflight requires a credential-free HTTPS SUPABASE_URL.");
  }
  const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
  if (!match) throw new Error("Supabase preflight could not derive a project reference from SUPABASE_URL.");
  return match[1].toLowerCase();
}

describe.skipIf(!shouldRun)("Supabase repository read-only preflight", () => {
  it("reads case integrity without performing writes or exposing content", async () => {
    const url = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase();
    if (!url || !serviceRoleKey || !expectedRef) {
      throw new Error("Supabase preflight requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and EXPECTED_SUPABASE_PROJECT_REF.");
    }

    const actualRef = projectRefFromUrl(url);
    if (actualRef !== expectedRef || actualRef !== TUTOR_PROJECT_REF) {
      throw new Error("Supabase preflight project reference guard failed.");
    }

    // The repository mapper warns with bounded diagnostics when it encounters
    // malformed stored media. Suppress that diagnostic payload in test output;
    // the assertion below remains the only result exposed by this preflight.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const repository = new SupabaseTutorRepository(url, serviceRoleKey);
      const result = await repository.listCaseVersionsWithDiagnostics();
      const caseCount = result.cases.length;
      const phaseCount = result.cases.reduce((total, item) => total + item.phases.length, 0);
      const attachmentCount = result.cases.reduce((total, item) => total + (item.attachments?.length ?? 0), 0);

      expect(result.diagnostics).toHaveLength(0);
      expect(caseCount).toBeGreaterThanOrEqual(0);
      expect(phaseCount).toBeGreaterThanOrEqual(0);
      expect(attachmentCount).toBeGreaterThanOrEqual(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
