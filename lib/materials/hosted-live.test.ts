import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClinicalCase } from "@/lib/domain";
import { studentView } from "@/lib/http";
import { resetRepositoryForTests } from "@/lib/repository";
import { InMemoryTutorRepository } from "@/lib/repository/memory";
import { SupabaseTutorRepository } from "@/lib/repository/supabase";
import { DEMO_STUDENT_ID } from "@/lib/seed";
import * as tutor from "@/lib/tutor";
import { finishSession, submitStudentAnswer } from "@/lib/tutor/state-machine";
import { getTeachingContextAsync } from "@/lib/materials/retrieval";

// Explicit, read-only cloud verification. All session/answer/summary writes
// remain in memory; this is not an exception to the production E2E write guard.
const live = process.env.RUN_HOSTED_MATERIALS_LIVE_TESTS === "true" ? describe : describe.skip;
const privateBucket = "teaching-material-references";
let packageId: string;
let projectUrl: string;
let cases: ClinicalCase[];
let media: Array<{ id: string; caseId: string; sha256: string }>;

live("published teaching materials: read-only cloud and in-memory live tutor", () => {
  beforeAll(async () => {
    if (process.env.VERCEL || process.env.TUTOR_MATERIALS_DIR || process.env.FORCE_MEMORY_REPOSITORY !== "true") {
      throw new Error("Hosted live validation requires local execution, no local pack, and FORCE_MEMORY_REPOSITORY=true.");
    }
    if (process.env.TUTOR_PROVIDER !== "openai" || !process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
      throw new Error("Hosted live validation requires the configured OpenAI provider.");
    }
    packageId = process.env.HOSTED_MATERIALS_PACKAGE_ID ?? "";
    projectUrl = process.env.SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!/^[a-f0-9]{64}$/.test(packageId) || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(projectUrl)) {
      throw new Error("Provide an explicit package ID and hosted Supabase credentials for read-only validation.");
    }
    const client = createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rows = await client.from("cases").select("id").eq("patient_context->>teachingMaterialPackageId", packageId).order("id");
    if (rows.error || !rows.data?.length) throw new Error("Published material case lookup failed.");
    const readOnlyRepository = new SupabaseTutorRepository(projectUrl, key);
    cases = [];
    for (const row of rows.data) {
      const clinicalCase = await readOnlyRepository.getCase(row.id);
      if (!clinicalCase) throw new Error("Published material case is unavailable.");
      expect(clinicalCase.teachingMaterialPackageId).toBe(packageId);
      cases.push(clinicalCase);
    }
    expect(cases.length).toBe(3);
    const reference = await client.storage.from(privateBucket).download(`${packageId}/manifest.json`, {}, { signal: AbortSignal.timeout(10_000) });
    if (reference.error || !reference.data) throw new Error("Private reference manifest download failed.");
    const manifest = JSON.parse(await reference.data.text());
    expect(manifest.packageId).toBe(packageId);
    expect(manifest.articles.filter((item: { sourceType?: string }) => item.sourceType !== "expert_interview").length).toBe(20);
    expect(manifest.articles.filter((item: { sourceType?: string }) => item.sourceType === "expert_interview").length).toBe(1);
    media = manifest.media;
    expect(media.length).toBe(19);
  }, 30_000);

  afterEach(() => {
    resetRepositoryForTests();
    vi.restoreAllMocks();
  });

  it.each([0, 1, 2])("grounds a real tutor turn and completes local session for case index %i", async (index) => {
    const repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
    const clinicalCase = cases[index];
    await repository.saveCase({ ...clinicalCase, status: "draft" }, "99999999-9999-4999-8999-999999999999");
    await repository.publishCase(clinicalCase.id);
    const session = await repository.createSession(DEMO_STUDENT_ID, clinicalCase.id);
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback");
    const started = performance.now();
    const updated = await submitStudentAnswer(session.session.id, DEMO_STUDENT_ID,
      "I would first identify a visible observation on the supplied OPG and describe the tooth and adjacent root relationships before deciding what the finding means.",
      crypto.randomUUID());
    const elapsed = Math.round(performance.now() - started);
    const context = evaluate.mock.calls[0]?.[0].caseContext?.teachingContext;
    expect(context?.expertNotes.length).toBeGreaterThan(0);
    expect(context?.literature.length).toBeGreaterThan(0);
    expect(updated.session.evaluations.at(-1)?.provider).toBe("openai");
    expect(updated.session.messages.filter((item) => item.sender === "student")).toHaveLength(1);
    expect(updated.session.messages.at(-1)?.sender).toBe("ai");
    const studentPayload = JSON.stringify(studentView(updated));
    // Some faculty notes repeat the public patient introduction. Check a
    // genuinely private excerpt, and do not dump source text on assertion failure.
    const privateExcerpt = context!.expertNotes.split(/\r?\n/)
      .map((line) => line.trim().slice(0, 80))
      .find((line) => line.length >= 60 && !clinicalCase.description.includes(line));
    expect(Boolean(privateExcerpt)).toBe(true);
    expect(studentPayload.includes("teachingMaterialPackageId")).toBe(false);
    expect(studentPayload.includes("expertNotes")).toBe(false);
    expect(studentPayload.includes(context!.sourceDocument)).toBe(false);
    expect(studentPayload.includes(privateExcerpt!)).toBe(false);
    const completedAt = performance.now();
    const finished = await finishSession(session.session.id, DEMO_STUDENT_ID);
    expect(finished.session.status).toBe("completed");
    expect(finished.session.summary?.strengths.length).toBeGreaterThan(0);
    expect(performance.now() - completedAt).toBeLessThan(1_000);
    console.info(JSON.stringify({ caseIndex: index, tutorMs: elapsed, provider: "openai", literaturePassages: context!.literature.length, sessionStorage: "memory" }));
  }, 40_000);

  it("serves every registered image losslessly through its published case attachment", async () => {
    // Three concurrent reads keep the validation bounded without stressing the origin.
    let checked = 0;
    for (let offset = 0; offset < media.length; offset += 3) {
      await Promise.all(media.slice(offset, offset + 3).map(async (item) => {
        const attachment = cases.find((candidate) => candidate.id === item.caseId)?.attachments?.find((candidate) => candidate.id === item.id);
        if (!attachment?.url) throw new Error("Published image attachment is unavailable.");
        expect(attachment.url.startsWith(`${projectUrl}/storage/v1/object/public/teaching-case-media/${packageId}/`)).toBe(true);
        const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
        expect(response.ok).toBe(true);
        expect(response.headers.get("content-type")).toContain("image/webp");
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
        checked += 1;
      }));
    }
    expect(checked).toBe(19);
  }, 90_000);

  it("does not expose the reference manifest through a public Storage URL", async () => {
    const response = await fetch(`${projectUrl}/storage/v1/object/public/${privateBucket}/${packageId}/manifest.json`, { signal: AbortSignal.timeout(10_000) });
    expect(response.ok).toBe(false);
    expect(await response.text()).not.toContain("expertNotes");
  }, 15_000);

  it("retrieves the new interview with case-specific expert and paragraph attribution", async () => {
    const clinicalCase = cases.find((item) => /case 3\b/i.test(item.title));
    if (!clinicalCase) throw new Error("Interview-linked case not found.");
    const context = await getTeachingContextAsync(clinicalCase.id,
      "Class III growth treatment timing midline shift monitor sooner earlier delay", packageId);
    const interview = context!.literature.filter((item) => item.sourceType === "expert_interview");
    expect(interview.length).toBeGreaterThan(0);
    expect(interview.every((item) => item.locator && item.expert && !/Comments on Case [12]\b/i.test(item.section ?? ""))).toBe(true);
    const repository = new InMemoryTutorRepository();
    repository.reset();
    resetRepositoryForTests(repository);
    await repository.saveCase({ ...clinicalCase, status: "draft" }, "99999999-9999-4999-8999-999999999999");
    await repository.publishCase(clinicalCase.id);
    const session = await repository.createSession(DEMO_STUDENT_ID, clinicalCase.id);
    const evaluate = vi.spyOn(tutor, "evaluateWithFallback");
    const updated = await submitStudentAnswer(session.session.id, DEMO_STUDENT_ID,
      "For the Class III growth pattern, I would weigh treatment timing, monitoring, a midline shift and the risks of acting earlier against delaying intervention.",
      crypto.randomUUID());
    const suppliedReferences = evaluate.mock.calls[0]?.[0].caseContext?.teachingContext?.literature ?? [];
    expect(suppliedReferences.some((item) => item.sourceType === "expert_interview" && item.expert && item.locator)).toBe(true);
    expect(updated.session.evaluations.at(-1)?.provider).toBe("openai");
    expect(updated.session.messages.at(-1)?.sender).toBe("ai");
    console.info(JSON.stringify({ interviewHits: interview.length, experts: interview.map((item) => item.expert), locators: interview.map((item) => item.locator) }));
  }, 40_000);
});
