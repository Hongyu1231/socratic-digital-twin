import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateCases,
  buildPrivateManifestPayload,
  buildPublicationPlan,
  createAssignments,
  clinicalContentHash,
  isMissingStorageObjectError,
  uploadIfMissing,
  validateManifest,
} from "./publish-teaching-materials.mjs";

const tempDirectories: string[] = [];

function uuid(seed: string) {
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socratic-publish-test-"));
  tempDirectories.push(root);
  fs.mkdirSync(path.join(root, "media"));
  const caseId = uuid("case");
  const phaseId = uuid("phase");
  const mediaId = uuid("media");
  const bytes = Buffer.alloc(32, 0x5a);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  const file = path.join(root, "media", `${mediaId}.webp`);
  fs.writeFileSync(file, bytes);
  const manifest: any = {
    formatVersion: 1,
    packageId: "a".repeat(64),
    cases: [{
      case: {
        id: caseId,
        title: "Synthetic canine case",
        description: "A synthetic case for publication validation.",
        difficulty: "intermediate",
        learningObjectives: ["Describe the record before forming a conclusion."],
        phases: [{
          id: phaseId,
          caseId,
          order: 1,
          title: "Observe",
          goal: "Describe a finding.",
          rubric: ["Name the record supporting the finding."],
          starterQuestion: "What do you observe?",
          exampleQuestions: ["Which record supports that observation?"],
          tutorGuidance: ["Use the record as evidence."],
          tutorMoves: [],
        }],
        attachments: [{
          id: mediaId,
          kind: "image",
          title: "Synthetic OPG",
          description: "A synthetic image for publication validation.",
          url: `/api/materials/${mediaId}`,
          sourceLabel: "Synthetic",
        }],
      },
      expertNotes: "This note must remain private.",
      sourceDocument: "synthetic.docx",
    }],
    articles: [{
      id: "article-1",
      title: "Synthetic article",
      filename: "synthetic.pdf",
      sha256: "b".repeat(64),
      sourceType: "expert_interview",
      pages: [{
        page: 1,
        text: "Synthetic reference text.",
        locator: "paragraph:12",
        expert: "Synthetic expert panel",
        section: "Consensus",
        caseIds: [caseId],
      }],
    }],
    media: [{
      id: mediaId,
      caseId,
      file: `media/${mediaId}.webp`,
      mimeType: "image/webp",
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      width: 32,
      height: 32,
    }],
  };
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
  return { root, manifest, caseId, mediaId };
}

afterEach(() => {
  while (tempDirectories.length) {
    const directory = tempDirectories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("teaching-material publication boundary", () => {
  it("stages marked clinical drafts but blocks publication without faculty approval", () => {
    const fixture = makeFixture();
    fixture.manifest.clinicalReview = { status: "pending", reviewer: null, approvedAt: null, contentSha256: clinicalContentHash(fixture.manifest.cases) };
    const manifest = validateManifest(fixture.manifest, fixture.root);
    const options = { manifest, supabaseUrl: "https://example.supabase.co", classId: uuid("class"), professorId: uuid("prof"), adminId: uuid("admin") };
    expect(buildPublicationPlan(options).assignments).toHaveLength(0);
    expect(() => buildPublicationPlan({ ...options, publish: true })).toThrow(/faculty approval/);
    expect(buildPrivateManifestPayload(manifest).clinicalReview.status).toBe("pending");
  });

  it("rejects stale or unattributed approval and preserves a valid approval through normalization", () => {
    const fixture = makeFixture();
    fixture.manifest.clinicalReview = { status: "approved", reviewer: "Test faculty", approvedAt: "2026-09-30T10:00:00Z", contentSha256: clinicalContentHash(fixture.manifest.cases) };
    const manifest = validateManifest(fixture.manifest, fixture.root);
    expect(buildPublicationPlan({ manifest, supabaseUrl: "https://example.supabase.co", classId: uuid("class"), professorId: uuid("prof"), adminId: uuid("admin"), publish: true }).assignments).toHaveLength(1);
    expect(() => validateManifest(buildPrivateManifestPayload(manifest), fixture.root)).not.toThrow();
    fixture.manifest.clinicalReview.reviewer = "";
    expect(() => validateManifest(fixture.manifest, fixture.root)).toThrow(/reviewer/);
    fixture.manifest.clinicalReview.reviewer = "Test faculty";
    fixture.manifest.cases[0].case.phases[0].goal = "Changed after approval";
    expect(() => validateManifest(fixture.manifest, fixture.root)).toThrow(/stale/);
  });
  it("requires strict clinical-review metadata for pending packs and normalizes accepted values", () => {
    const fixture = makeFixture();
    const hash = clinicalContentHash(fixture.manifest.cases);
    const invalidReviews = [
      { status: "pending", approvedAt: null, contentSha256: hash },
      { status: "pending", reviewer: null, contentSha256: hash },
      { status: "pending", reviewer: "   ", approvedAt: null, contentSha256: hash },
      { status: "pending", reviewer: null, approvedAt: "2026-09-30T10:00:00", contentSha256: hash },
      { status: "pending", reviewer: null, approvedAt: null, contentSha256: hash, unexpected: true },
    ];
    for (const clinicalReview of invalidReviews) {
      fixture.manifest.clinicalReview = clinicalReview;
      expect(() => validateManifest(fixture.manifest, fixture.root)).toThrow(/Clinical review metadata is invalid/);
    }

    fixture.manifest.clinicalReview = {
      status: "pending",
      reviewer: "  Faculty reviewer  ",
      approvedAt: null,
      contentSha256: hash.toUpperCase(),
    };
    const manifest = validateManifest(fixture.manifest, fixture.root);
    expect(manifest.clinicalReview).toEqual({
      status: "pending",
      reviewer: "Faculty reviewer",
      approvedAt: null,
      contentSha256: hash,
    });
  });

  it("requires an offset-bearing timestamp before an approved pack can publish", () => {
    const fixture = makeFixture();
    fixture.manifest.clinicalReview = {
      status: "approved",
      reviewer: "Test faculty",
      approvedAt: "2026-09-30T10:00:00",
      contentSha256: clinicalContentHash(fixture.manifest.cases),
    };
    expect(() => validateManifest(fixture.manifest, fixture.root)).toThrow(/Clinical review metadata is invalid/);
  });

  it("does not apply long public caching to private signed media", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = { storage: { from: () => ({ download: async () => ({ data: null, error: { name: "NotFound" } }), upload }) } };
    const bytes = Buffer.from("synthetic bytes");
    await uploadIfMissing(client, "teaching-case-media-private", "synthetic/image.webp", bytes, "image/webp");
    expect(upload).toHaveBeenCalledWith("synthetic/image.webp", bytes, { contentType: "image/webp", cacheControl: "0", upsert: false });
  });
  it("preserves explicit replacement lineage and defaults assignment migration on", () => {
    const fixture = makeFixture();
    fixture.manifest.cases[0].case.sourceCaseId = uuid("previous-root");
    fixture.manifest.cases[0].case.version = 2;
    const manifest = validateManifest(fixture.manifest, fixture.root);
    const options = { manifest, supabaseUrl: "https://example.supabase.co", classId: uuid("class"), professorId: uuid("prof"), adminId: uuid("admin"), publish: true };
    const plan = buildPublicationPlan(options);
    expect(plan.cases[0].case).toMatchObject({ source_case_id: uuid("previous-root"), version: 2 });
    expect(plan.moveOpenAssignments).toBe(true);
    expect(buildPublicationPlan({ ...options, moveOpenAssignments: false }).moveOpenAssignments).toBe(false);
    fixture.manifest.cases[0].case.sourceCaseId = fixture.caseId;
    expect(() => validateManifest(fixture.manifest, fixture.root)).toThrow(/version lineage/);
    delete fixture.manifest.cases[0].case.sourceCaseId;
    expect(() => validateManifest(fixture.manifest, fixture.root)).toThrow(/version lineage/);
  });

  it("publishes only through the atomic version RPC with no direct-update fallback", async () => {
    const fixture = makeFixture();
    const manifest = validateManifest(fixture.manifest, fixture.root);
    const plan = buildPublicationPlan({ manifest, supabaseUrl: "https://example.supabase.co", classId: uuid("class"), professorId: uuid("prof"), adminId: uuid("admin"), moveOpenAssignments: false });
    const row = plan.cases[0].case;
    const current = { ...row, status: "draft" };
    const read = { maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }) };
    const client = {
      from: vi.fn(() => ({ select: () => ({ eq: () => read, in: () => Promise.resolve({ data: [{ id: row.id, status: "active", published_at: "2026-01-01T00:00:00Z" }], error: null }) }) })),
      rpc: vi.fn().mockResolvedValue({ data: { id: row.id }, error: null }),
    };
    await activateCases(client, plan);
    expect(client.rpc).toHaveBeenCalledWith("publish_case", { p_case_id: row.id, p_published_at: expect.any(String), p_move_open_assignments: false });
    client.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    await expect(activateCases(client, plan)).rejects.toThrow(/Activate case/);
  });

  it("does not create duplicate offerings after the publish RPC moved an assignment", async () => {
    const fixture = makeFixture();
    fixture.manifest.cases[0].case.sourceCaseId = uuid("root");
    fixture.manifest.cases[0].case.version = 2;
    const plan = buildPublicationPlan({ manifest: validateManifest(fixture.manifest, fixture.root), supabaseUrl: "https://example.supabase.co", classId: uuid("class"), adminId: uuid("admin"), professorId: uuid("prof"), publish: true });
    const query = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), limit: vi.fn().mockResolvedValue({ data: [{ id: uuid("moved-assignment") }], error: null }) };
    query.eq.mockReturnValue(query);
    const insert = vi.fn();
    const client = { from: vi.fn(() => ({ select: () => query, insert })) };
    await createAssignments(client, plan, uuid("prof"));
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("validates registered WebP media and builds a bounded draft plan", () => {
    const fixture = makeFixture();
    const manifest = validateManifest(fixture.manifest, fixture.root);
    const plan = buildPublicationPlan({
      manifest,
      supabaseUrl: "https://zulvdacbqvmqmtotyeuc.supabase.co",
      classId: "11111111-1111-4111-8111-111111111111",
      professorId: "22222222-2222-4222-8222-222222222222",
      adminId: "99999999-9999-4999-8999-999999999999",
    });

    expect(manifest.media).toHaveLength(1);
    expect(plan.caseIds).toEqual([fixture.caseId]);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.cases[0].case.status).toBe("draft");
    expect(plan.cases[0].case.difficulty).toBe("intermediate");
    expect(plan.cases[0].case.patient_context).toEqual({ teachingMaterialPackageId: fixture.manifest.packageId });
    expect(plan.privateMedia).toBe(true);
    expect(plan.mediaBucket).toBe("teaching-case-media-private");
    expect(plan.cases[0].case.attachments[0].storagePath).toBe(`${fixture.manifest.packageId}/${fixture.mediaId}.webp`);
    expect(plan.cases[0].case.attachments[0]).not.toHaveProperty("url");
    expect(plan.cases[0].case.attachments[0]).not.toHaveProperty("sourceUrl");
    expect(JSON.stringify(plan)).not.toContain("This note must remain private");
    expect(JSON.stringify(plan)).not.toContain("synthetic.docx");
    expect(JSON.stringify(plan)).not.toContain("Synthetic reference text.");

    const privateManifest = buildPrivateManifestPayload(manifest);
    expect(privateManifest.articles[0]).toMatchObject({ sourceType: "expert_interview" });
    expect(privateManifest.articles[0].pages[0]).toMatchObject({
      locator: "paragraph:12",
      expert: "Synthetic expert panel",
      section: "Consensus",
      caseIds: [fixture.caseId],
    });
    expect(JSON.stringify(privateManifest)).toContain("Synthetic reference text.");
  });

  it("uses the shared case description and media URL limits", () => {
    const fixture = makeFixture();
    fixture.manifest.cases[0].case.description = "d".repeat(2_000);
    fixture.manifest.cases[0].case.attachments[0].description = "a".repeat(2_000);
    fixture.manifest.cases[0].case.attachments[0].url = `/${"u".repeat(2_047)}`;
    const manifest = validateManifest(fixture.manifest, fixture.root);
    expect(manifest.cases[0].case.description).toHaveLength(2_000);
    expect(manifest.cases[0].case.attachments[0].description).toHaveLength(2_000);
    expect(manifest.cases[0].case.attachments[0].url).toHaveLength(2_048);

    const tooLong = structuredClone(fixture.manifest);
    tooLong.cases[0].case.description = "d".repeat(2_001);
    expect(() => validateManifest(tooLong, fixture.root)).toThrow(/case description/i);

    const attachmentTooLong = structuredClone(fixture.manifest);
    attachmentTooLong.cases[0].case.attachments[0].description = "a".repeat(2_001);
    expect(() => validateManifest(attachmentTooLong, fixture.root)).toThrow(/attachment description/i);

    const attachmentTitleTooLong = structuredClone(fixture.manifest);
    attachmentTitleTooLong.cases[0].case.attachments[0].title = "t".repeat(161);
    expect(() => validateManifest(attachmentTitleTooLong, fixture.root)).toThrow(/attachment title/i);

    const attachmentUrlTooLong = structuredClone(fixture.manifest);
    attachmentUrlTooLong.cases[0].case.attachments[0].url = `/${"u".repeat(2_048)}`;
    expect(() => validateManifest(attachmentUrlTooLong, fixture.root)).toThrow(/attachment URL/i);
  });

  it("creates stable assignment keys only for explicit publication", () => {
    const fixture = makeFixture();
    const manifest = validateManifest(fixture.manifest, fixture.root);
    const plan = buildPublicationPlan({
      manifest,
      supabaseUrl: "https://zulvdacbqvmqmtotyeuc.supabase.co",
      classId: "11111111-1111-4111-8111-111111111111",
      professorId: "22222222-2222-4222-8222-222222222222",
      adminId: "99999999-9999-4999-8999-999999999999",
      publish: true,
    });

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].idempotency_key).toBe(`materials:${fixture.manifest.packageId}:11111111-1111-4111-8111-111111111111:${fixture.caseId}`);
    expect(plan.assignments[0].status).toBe("open");
    expect(plan.assignments[0].opens_at).toBe("<execution-time>");
  });

  it("supports an explicit private-media dry-run without persisting a public URL", () => {
    const fixture = makeFixture();
    const manifest = validateManifest(fixture.manifest, fixture.root);
    const plan = buildPublicationPlan({
      manifest,
      supabaseUrl: "https://zulvdacbqvmqmtotyeuc.supabase.co",
      classId: "11111111-1111-4111-8111-111111111111",
      professorId: "22222222-2222-4222-8222-222222222222",
      adminId: "99999999-9999-4999-8999-999999999999",
      privateMedia: true,
    });

    expect(plan.privateMedia).toBe(true);
    expect(plan.mediaBucket).toBe("teaching-case-media-private");
    expect(plan.privateMediaPaths).toEqual([`${fixture.manifest.packageId}/${fixture.mediaId}.webp`]);
    expect(plan.publicMediaPaths).toEqual([]);
    expect(plan.cases[0].case.attachments[0]).toMatchObject({
      storagePath: `${fixture.manifest.packageId}/${fixture.mediaId}.webp`,
      unlockPhase: 1,
      unlockOnRequest: false,
      sourceLabel: "Private teaching media (server-authorized)",
    });
    expect(plan.cases[0].case.attachments[0]).not.toHaveProperty("url");
    expect(plan.cases[0].case.attachments[0]).not.toHaveProperty("sourceUrl");
  });

  it("preserves a later attachment unlock phase in private-media mode", () => {
    const fixture = makeFixture();
    fixture.manifest.cases[0].case.phases.push({
      id: uuid("phase-2"),
      caseId: fixture.caseId,
      order: 2,
      title: "Interpret",
      goal: "Interpret the finding.",
      rubric: ["Connect the finding to the decision."],
      starterQuestion: "What does the finding change?",
      exampleQuestions: ["Which decision does it affect?"],
      tutorGuidance: [],
      tutorMoves: [],
    });
    fixture.manifest.cases[0].case.attachments[0].unlockPhase = 2;

    const manifest = validateManifest(fixture.manifest, fixture.root);
    const plan = buildPublicationPlan({
      manifest,
      supabaseUrl: "https://zulvdacbqvmqmtotyeuc.supabase.co",
      classId: "11111111-1111-4111-8111-111111111111",
      professorId: "22222222-2222-4222-8222-222222222222",
      adminId: "99999999-9999-4999-8999-999999999999",
      privateMedia: true,
    });

    expect(plan.cases[0].case.attachments[0]).toMatchObject({
      storagePath: `${fixture.manifest.packageId}/${fixture.mediaId}.webp`,
      unlockPhase: 2,
      unlockOnRequest: false,
    });
  });

  it("normalizes legacy rubric strings, preserves explicit criteria, and writes text-only objectives", () => {
    const fixture = makeFixture();
    fixture.manifest.cases[0].case.phases[0].rubric = [
      { id: "observation", text: "States the visible observation.", revealText: "State only what the record shows." },
      "Names the supporting record.",
    ];
    fixture.manifest.cases[0].case.phases[0].noProgressLimit = 4;
    fixture.manifest.cases[0].case.phases[0].phaseCeiling = 12;
    fixture.manifest.cases[0].case.phases[0].tutorMoves = [{
      id: "observation-probe",
      strategy: "probe",
      question: "Which record supports that observation?",
      targetCriterionId: "observation",
    }];
    fixture.manifest.cases[0].case.findings = [{
      id: "finding-1",
      title: "Visible finding",
      text: "The finding is released with phase one.",
    }];
    fixture.manifest.cases[0].case.correctionProbes = 2;

    const manifest = validateManifest(fixture.manifest, fixture.root);
    const plan = buildPublicationPlan({
      manifest,
      supabaseUrl: "https://zulvdacbqvmqmtotyeuc.supabase.co",
      classId: "11111111-1111-4111-8111-111111111111",
      professorId: "22222222-2222-4222-8222-222222222222",
      adminId: "99999999-9999-4999-8999-999999999999",
    });

    expect(plan.cases[0].phases[0].objectives).toEqual([
      "Describe a finding.",
      "States the visible observation.",
      "Names the supporting record.",
    ]);
    expect(plan.cases[0].phases[0].metadata).toMatchObject({
      rubric: [
        { id: "observation", text: "States the visible observation.", revealText: "State only what the record shows." },
        { id: "r2", text: "Names the supporting record." },
      ],
      noProgressLimit: 4,
      phaseCeiling: 12,
    });
    expect(plan.cases[0].case.patient_context).toMatchObject({
      correctionProbes: 2,
      findings: [{ id: "finding-1", unlockPhase: 1 }],
    });
  });

  it("rejects generated criterion id collisions and scripted moves outside their phase", () => {
    const fixture = makeFixture();
    const collision = structuredClone(fixture.manifest);
    collision.cases[0].case.phases[0].rubric = ["first", { id: "r1", text: "collides with the first legacy criterion" }];
    expect(() => validateManifest(collision, fixture.root)).toThrow(/duplicate rubric criterion id/i);

    const invalidMove = structuredClone(fixture.manifest);
    invalidMove.cases[0].case.phases[0].tutorMoves = [{
      id: "bad-target",
      strategy: "probe",
      question: "Which record supports that observation?",
      targetCriterionId: "not-in-this-phase",
    }];
    expect(() => validateManifest(invalidMove, fixture.root)).toThrow(/outside its phase/i);
  });

  it("rejects an unregistered or modified media object before any write", () => {
    const fixture = makeFixture();
    const modified = structuredClone(fixture.manifest);
    modified.media[0].sha256 = "c".repeat(64);
    expect(() => validateManifest(modified, fixture.root)).toThrow(/WebP or hash/);

    const unregistered = structuredClone(fixture.manifest);
    unregistered.cases[0].case.attachments = [];
    expect(() => validateManifest(unregistered, fixture.root)).toThrow(/unregistered media/);
  });

  it("rejects media paths that escape the pack directory", () => {
    const fixture = makeFixture();
    const traversal = structuredClone(fixture.manifest);
    traversal.media[0].file = "../outside.webp";
    expect(() => validateManifest(traversal, fixture.root)).toThrow(/media (entry|mapping) is invalid/i);
  });

  it("rejects invalid interview provenance before any write", () => {
    const fixture = makeFixture();
    const missingLocator = structuredClone(fixture.manifest);
    Reflect.deleteProperty(missingLocator.articles[0].pages[0], "locator");
    expect(() => validateManifest(missingLocator, fixture.root)).toThrow(/locator and expert attribution/);

    const unknownCase = structuredClone(fixture.manifest);
    unknownCase.articles[0].pages[0].caseIds = [uuid("unknown-case")];
    expect(() => validateManifest(unknownCase, fixture.root)).toThrow(/unknown case/);

    const invalidSource = structuredClone(fixture.manifest);
    invalidSource.articles[0].sourceType = "panel_notes";
    expect(() => validateManifest(invalidSource, fixture.root)).toThrow(/source type/);
  });

  it("treats only an explicit missing-object response as safe to upload", async () => {
    expect(isMissingStorageObjectError({ status: 400, statusCode: "404" })).toBe(true);
    expect(isMissingStorageObjectError({ name: "NotFound" })).toBe(true);
    expect(isMissingStorageObjectError({ status: 400, statusCode: "400", message: "network failure" })).toBe(false);

    const upload = vi.fn(async () => ({ error: null }));
    const objectBytes = Buffer.from("bytes");
    const missingClient = {
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" } }),
          upload,
        }),
      },
    };
    await expect(uploadIfMissing(missingClient, "bucket", "object", objectBytes, "application/octet-stream"))
      .resolves.toBe("uploaded");
    expect(upload).toHaveBeenCalledTimes(1);

    const existingClient = {
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob([objectBytes]), error: null }),
          upload,
        }),
      },
    };
    await expect(uploadIfMissing(existingClient, "bucket", "object", objectBytes, "application/octet-stream"))
      .resolves.toBe("existing");
    expect(upload).toHaveBeenCalledTimes(1);

    const unavailableClient = {
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: { name: "StorageApiError", message: "Bad Request", status: 400, statusCode: "400" } }),
          upload,
        }),
      },
    };
    await expect(uploadIfMissing(unavailableClient, "bucket", "object", objectBytes, "application/octet-stream"))
      .rejects.toThrow(/Check storage object/);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
