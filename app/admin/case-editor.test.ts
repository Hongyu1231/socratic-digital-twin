import { describe, expect, it } from "vitest";
import {
  caseActionPolicy,
  cloneCaseDraft,
  diagnosticsForCase,
  diagnosticsForDraft,
  normalizeDiagnostics,
  serializeCaseDraft,
  type CaseVersionDraft,
} from "@/app/admin/case-editor";

describe("admin case editor serialization", () => {
  it("treats superseded versions as immutable historical records", () => {
    expect(caseActionPolicy("superseded")).toEqual({
      canEdit: false,
      canPublish: false,
      canClone: true,
      canArchive: false,
    });
    expect(caseActionPolicy("draft")).toMatchObject({ canEdit: true, canPublish: true, canClone: false, canArchive: true });
  });

  it("round-trips v2 fields without flattening structured rubric or staged content", () => {
    const draft: CaseVersionDraft = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "  Synthetic OPG case  ",
      description: "  A staged teaching case.  ",
      difficulty: "advanced",
      status: "draft",
      version: 3,
      learningObjectives: ["Use supplied evidence."],
      correctionProbes: 2,
      phases: [{
        id: "22222222-2222-4222-8222-222222222222",
        order: 1,
        title: "Observe",
        goal: "Separate findings from assumptions.",
        rubric: [
          { id: "finding", text: "Name the finding", revealText: "Use the supplied record." },
          "Explain why it matters",
        ],
        noProgressLimit: 3,
        phaseCeiling: 6,
        starterQuestion: "What do you observe?",
        exampleQuestions: ["Which record supports it?"],
        tutorGuidance: ["Ask for one evidence link."],
        tutorMoves: [{
          id: "move-1",
          strategy: "probe",
          question: "Which record supports that?",
          targetCriterionId: "finding",
        }],
      }],
      attachments: [{
        id: "33333333-3333-4333-8333-333333333333",
        kind: "image",
        title: "OPG",
        description: "Published teaching image.",
        storagePath: "cases/case/opg.webp",
        unlockPhase: 1,
        unlockOnRequest: false,
      }],
      findings: [{
        id: "finding-1",
        title: "Initial record",
        text: "Synthetic record text.",
        unlockPhase: 1,
        unlockOnRequest: false,
      }],
    };

    const roundTripped = serializeCaseDraft(cloneCaseDraft(draft));

    expect(roundTripped.title).toBe("Synthetic OPG case");
    expect(roundTripped.phases?.[0]).toMatchObject({ noProgressLimit: 3, phaseCeiling: 6 });
    expect(roundTripped.phases?.[0]?.rubric).toEqual([
      { id: "finding", text: "Name the finding", revealText: "Use the supplied record." },
      "Explain why it matters",
    ]);
    expect(roundTripped.phases?.[0]?.tutorMoves?.[0]?.targetCriterionId).toBe("finding");
    expect(roundTripped.attachments?.[0]).toMatchObject({
      storagePath: "cases/case/opg.webp",
      unlockPhase: 1,
      unlockOnRequest: false,
    });
    expect(roundTripped.findings?.[0]).toMatchObject({ id: "finding-1", unlockPhase: 1, unlockOnRequest: false });
    expect(roundTripped.correctionProbes).toBe(2);
  });

  it("normalizes diagnostics without exposing malformed or unbounded reasons", () => {
    const diagnostics = normalizeDiagnostics([
      { caseId: "case-1", attachmentId: "attachment-1", index: 0, reasons: ["Missing ID", "x".repeat(500)] },
      { caseId: "case-1", attachmentId: null, index: 1, reasons: [] },
      { caseId: "case-2", attachmentId: null, index: 0, reasons: ["Wrong case"] },
      "malformed",
    ]);

    expect(diagnostics).toHaveLength(2);
    expect(diagnosticsForCase(diagnostics, "case-1")).toHaveLength(1);
    expect(diagnostics[0].reasons[1]).toHaveLength(240);
    expect(diagnosticsForDraft(diagnostics, "case-1")).toHaveLength(1);
  });

  it("keeps persisted diagnostics blocking even when the filtered row is absent", () => {
    const diagnostics = [{ caseId: "case-1", attachmentId: null, index: 0, reasons: ["Missing stable ID"] }];
    expect(diagnosticsForDraft(diagnostics, "case-1")).toEqual(diagnostics);
  });
});
