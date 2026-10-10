import { describe, expect, it } from "vitest";
import { mapCase, mapCaseWithDiagnostics, mapEvaluation, mapMessage, mapPhase } from "@/lib/repository/supabase";

describe("Supabase case mapping", () => {
  it("does not turn expected_findings JSON keys into student-facing rubric criteria", () => {
    const phase = mapPhase({
      id: crypto.randomUUID(),
      case_id: crypto.randomUUID(),
      phase_order: 1,
      title: "Problem identification",
      objectives: [
        "Identify the clinical concern",
        "Relate eruption asymmetry and timing to clinical significance",
      ],
      questions: ["What stands out?", "Why does it matter?"],
      teaching_notes: "Start with the narrative.",
      expected_findings: { age: 12, key_history: ["delayed eruption"] },
      metadata: {},
    });

    expect(phase.rubric).toEqual(["Relate eruption asymmetry and timing to clinical significance"]);
    expect(phase.rubric).not.toContain("age");
    expect(phase.rubric).not.toContain("key_history");
  });

  it("keeps only a validated hosted package pointer on the server-side case", () => {
    const packageId = "a".repeat(64);
    const clinicalCase = mapCase({
      id: crypto.randomUUID(),
      title: "Hosted case",
      presenting_complaint: "A bounded teaching case.",
      status: "active",
      tags: ["reasoning"],
      patient_context: { teachingMaterialPackageId: packageId.toUpperCase() },
      attachments: [],
    }, []);

    expect(clinicalCase.teachingMaterialPackageId).toBe(packageId);
  });

  it("maps persisted difficulty and never invents attachment IDs", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const result = mapCaseWithDiagnostics({
      id: crypto.randomUUID(),
      title: "Case with stable media",
      presenting_complaint: "A bounded teaching case.",
      difficulty: "advanced",
      status: "active",
      attachments: [
        { id, kind: "image", title: "OPG", description: "A record.", url: "/media/opg.webp" },
        { kind: "image", title: "Legacy", description: "Missing ID.", url: "/media/legacy.webp" },
      ],
    }, []);

    expect(result.case.difficulty).toBe("advanced");
    expect(result.case.attachments).toEqual([expect.objectContaining({ id })]);
    expect(result.case.attachments?.some((item) => item.id === undefined)).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ attachmentId: null, reasons: [expect.stringContaining("stable ID")] })]);
  });

  it("rejects an unsafe hosted package pointer instead of silently dropping grounding", () => {
    expect(() => mapCase({
      id: crypto.randomUUID(),
      title: "Malformed hosted case",
      presenting_complaint: "A bounded teaching case.",
      status: "active",
      patient_context: { teachingMaterialPackageId: "https://example.com/materials.json" },
      attachments: [],
    }, [])).toThrow("teaching-material reference is invalid");
  });

  it("round-trips structured rubric criteria and progression limits", () => {
    const phase = mapPhase({
      id: crypto.randomUUID(),
      case_id: crypto.randomUUID(),
      phase_order: 1,
      title: "Observe",
      objectives: ["Observe the record", "Legacy fallback criterion"],
      questions: ["What do you notice?"],
      teaching_notes: "Start with the record.",
      metadata: {
        rubric: [{ id: "finding", text: "Name the key finding", revealText: "Look at eruption timing." }],
        noProgressLimit: 2,
        phaseCeiling: 5,
      },
    });

    expect(phase.rubric).toEqual([{ id: "finding", text: "Name the key finding", revealText: "Look at eruption timing." }]);
    expect(phase).toMatchObject({ noProgressLimit: 2, phaseCeiling: 5 });
  });

  it("round-trips accepted extras separately from required rubric criteria", () => {
    const phase = mapPhase({
      id: crypto.randomUUID(),
      case_id: crypto.randomUUID(),
      phase_order: 1,
      title: "Observe",
      objectives: ["Observe the record", "Legacy fallback criterion"],
      questions: ["What do you notice?"],
      metadata: {
        rubric: [{ id: "finding", text: "Name the key finding" }],
        acceptedExtras: [{ id: "context", text: "Recognise the wider context." }],
      },
    });

    expect(phase.acceptedExtras).toEqual([{ id: "context", text: "Recognise the wider context." }]);
    expect(phase.rubric).toEqual([{ id: "finding", text: "Name the key finding" }]);
  });

  it("fails safe when accepted extras are malformed or collide with a rubric id", () => {
    const base = {
      id: crypto.randomUUID(),
      case_id: crypto.randomUUID(),
      phase_order: 1,
      title: "Observe",
      objectives: ["Observe the record", "Legacy fallback criterion"],
      questions: ["What do you notice?"],
      metadata: { rubric: [{ id: "finding", text: "Name the key finding" }] },
    };

    expect(mapPhase({ ...base, metadata: { ...base.metadata, acceptedExtras: [{ id: "finding", text: "Collision." }] } }).acceptedExtras)
      .toEqual([]);
    expect(mapPhase({ ...base, metadata: { ...base.metadata, acceptedExtras: [{ id: "context", text: "Valid." }, { id: "", text: "Malformed." }] } }).acceptedExtras)
      .toEqual([]);
    expect(mapPhase({ ...base, metadata: {} }).acceptedExtras).toEqual([]);
  });

  it("maps findings, correction policy and evaluation trace fields", () => {
    const clinicalCase = mapCase({
      id: crypto.randomUUID(),
      title: "Grounded case",
      presenting_complaint: "A bounded teaching case.",
      status: "active",
      tags: ["reasoning"],
      patient_context: {
        findings: [{ id: "finding-1", title: "Eruption asymmetry", text: "The canine is unerupted.", unlockPhase: 2 }],
        correctionProbes: 2,
      },
      attachments: [],
    }, []);
    const evaluation = mapEvaluation({
      id: crypto.randomUUID(),
      message_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      criteria: {
        classification: "partial",
        confidence: 0.9,
        reasoningGap: "Needs a consequence.",
        strategy: "probe",
        phaseComplete: false,
        feedback: "Explain why.",
        targetCriterionId: "consequence",
        answerCriterionId: "finding",
        criteriaMet: ["finding"],
        supportLevel: 1,
        completedWithSupport: true,
        isReflection: false,
        retrieval: { query: "canine", passages: [{ sourceId: "paper", page: 3, score: 0.8 }] },
      },
    });

    expect(clinicalCase).toMatchObject({
      correctionProbes: 2,
      findings: [{ id: "finding-1", unlockPhase: 2 }],
    });
    expect(evaluation).toMatchObject({
      targetCriterionId: "consequence",
      answerCriterionId: "finding",
      criteriaMet: ["finding"],
      supportLevel: 1,
      completedWithSupport: true,
      retrieval: { query: "canine" },
    });

    expect(mapEvaluation({
      id: crypto.randomUUID(),
      message_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      criteria: {},
    }).answerCriterionId).toBeNull();
  });

  it("round-trips Help provenance from message metadata without inventing an evaluation", () => {
    const marker = mapMessage({
      id: "help-marker",
      session_id: "session-1",
      role: "student",
      content: "Requested more help",
      created_at: "2026-10-09T00:00:00.000Z",
      metadata: {
        source: "student",
        turnKind: "help",
        helpRequested: true,
        clientRequestId: "help-1",
        phaseOrder: 2,
        supportLevel: 1,
        completedWithSupport: false,
      },
    });
    const reply = mapMessage({
      id: "help-reply",
      session_id: "session-1",
      role: "tutor",
      content: "Here is a plan to critique. What evidence would change your view?",
      created_at: "2026-10-09T00:00:01.000Z",
      metadata: {
        source: "socratic_tutor",
        turnKind: "help",
        helpRequested: true,
        clientRequestId: "help-1",
        replyToMessageId: "help-marker",
        phaseOrder: 2,
        supportLevel: 1,
        completedWithSupport: false,
        moveType: "hypothetical",
      },
    });

    expect(marker).toMatchObject({
      content: "Requested more help",
      turnKind: "help",
      helpRequested: true,
      clientRequestId: "help-1",
      phaseOrder: 2,
      supportLevel: 1,
      completedWithSupport: false,
    });
    expect(reply).toMatchObject({
      turnKind: "help",
      helpRequested: true,
      clientRequestId: "help-1",
      replyToMessageId: "help-marker",
      moveType: "hypothetical",
      supportLevel: 1,
    });
  });

  it("treats untagged historical student messages as answer turns", () => {
    expect(mapMessage({
      id: "legacy-answer",
      session_id: "session-legacy",
      role: "student",
      content: "The canine is unerupted.",
      created_at: "2026-01-01T00:00:00.000Z",
      metadata: { source: "student" },
    })).toMatchObject({ turnKind: "answer", helpRequested: false });
  });
});
