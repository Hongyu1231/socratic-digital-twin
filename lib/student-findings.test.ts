import { describe, expect, it } from "vitest";
import type { ClinicalCase } from "@/lib/domain";
import { studentCaseView } from "@/lib/http";

const clinicalCase: ClinicalCase = {
  id: "case-1", title: "Synthetic finding visibility case", description: "Synthetic records only.",
  difficulty: "intermediate", status: "draft", learningObjectives: ["Read the supplied records."],
  phases: [1, 2].map(order => ({
    id: `phase-${order}`, caseId: "case-1", order, title: `Phase ${order}`, goal: "Use the released evidence.",
    rubric: [{ id: "faculty-only-id", text: "Private marking point.", revealText: "Private reveal." }],
    acceptedExtras: [{ id: "faculty-only-bonus", text: "Private optional point." }],
    tutorGuidance: ["Private faculty guidance."], starterQuestion: "What do the records show?",
    exampleQuestions: ["Which record supports that?"], tutorMoves: [],
  })),
  attachments: [],
  findings: [
    { id: "case1-palatal-palpation", title: "Clinical palpation",
      text: "A canine bulge is palpable on the palatal aspect of the #23 region.", unlockPhase: 1, unlockOnRequest: false },
    { id: "later-cbct", title: "Later imaging", text: "LATER_PHASE_FINDING", unlockPhase: 2 },
  ],
};

describe("released findings are student case information, not internal marking notes", () => {
  it("does not release findings in the assignment catalogue", () => {
    expect(studentCaseView(clinicalCase).findings).toEqual([]);
  });

  it("shows a phase-one palpation finding verbatim without later findings or faculty material", () => {
    const view = studentCaseView(clinicalCase, 1);
    expect(view.findings).toEqual([{
      id: "case1-palatal-palpation", title: "Clinical palpation",
      text: "A canine bulge is palpable on the palatal aspect of the #23 region.", unlockPhase: 1,
    }]);
    expect(JSON.stringify(view)).not.toMatch(/LATER_PHASE_FINDING|faculty-only|Private|rubric|acceptedExtras|tutorGuidance|revealText/);
  });

  it("releases later findings only when the session reaches their phase", () => {
    expect(studentCaseView(clinicalCase, 2).findings?.map(finding => finding.id))
      .toEqual(["case1-palatal-palpation", "later-cbct"]);
  });
});
