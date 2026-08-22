import { describe, expect, it } from "vitest";
import { mapPhase } from "@/lib/repository/supabase";

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
});
