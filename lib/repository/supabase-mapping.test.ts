import { describe, expect, it } from "vitest";
import { mapCase, mapEvaluation, mapPhase } from "@/lib/repository/supabase";

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
      criteriaMet: ["finding"],
      supportLevel: 1,
      completedWithSupport: true,
      retrieval: { query: "canine" },
    });
  });
});
