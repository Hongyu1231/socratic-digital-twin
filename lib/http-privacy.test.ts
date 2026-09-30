import { describe, expect, it } from "vitest";
import type { ClinicalCase } from "@/lib/domain";
import { studentCaseView, studentView, studentOfferingView } from "@/lib/http";
import { impactedCanineCase, DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID } from "@/lib/seed";
import { InMemoryTutorRepository } from "@/lib/repository/memory";

describe("case diagnostics privacy boundary", () => {
  it("does not expose admin attachment diagnostics or future server fields", () => {
    const clinicalCase: ClinicalCase & { facultyOnly: string; diagnostics: unknown[] } = {
      ...impactedCanineCase,
      diagnostics: [{
        index: 0,
        attachmentId: null,
        reasons: ["INVALID_STORED_ATTACHMENT_SENTINEL"],
      }],
      facultyOnly: "PRIVATE_FACULTY_SENTINEL",
    };
    for (const phase of [undefined, 1]) {
      const view = studentCaseView(clinicalCase, phase);
      expect(view).not.toHaveProperty("diagnostics");
      expect(view).not.toHaveProperty("facultyOnly");
      expect(JSON.stringify(view)).not.toContain("SENTINEL");
    }
  });

  it("allowlists every session layer and omits all learner state and other users", async () => {
    const repository = new InMemoryTutorRepository();
    repository.reset();
    const bundle = await repository.createSession(DEMO_STUDENT_ID, IMPACTED_CANINE_CASE_ID);
    Object.assign(bundle, { privateFutureField: "TOP_SENTINEL" });
    Object.assign(bundle.session, { privateFutureField: "SESSION_SENTINEL" });
    Object.assign(bundle.session.messages[0], { privateFutureField: "MESSAGE_SENTINEL" });
    Object.assign(bundle.runtime, { privateFutureField: "RUNTIME_SENTINEL" });
    bundle.session.state.strengths = ["STATE_SENTINEL"];
    bundle.student.email = "EMAIL_SENTINEL";
    bundle.session.summary = {
      overallScore: 70, headline: "Summary", narrative: "Practice summary", strengths: ["Engaged"],
      weaknesses: [], nextSteps: ["Revisit the evidence"], completedAllPhases: false,
    };
    Object.assign(bundle.session.summary, { privateFutureField: "SUMMARY_SENTINEL" });
    const view = studentView(bundle);
    expect(Object.keys(view).sort()).toEqual(["case", "runtime", "session", "summaryGenerationStatus"]);
    expect(view.session).not.toHaveProperty("state");
    expect(view.session).not.toHaveProperty("evaluations");
    expect(view).not.toHaveProperty("student");
    expect(view).not.toHaveProperty("teachingClass");
    expect(view.case.phases[0]).not.toHaveProperty("rubric");
    expect(JSON.stringify(view)).not.toContain("SENTINEL");
    expect(view.session.summary?.headline).toBe("Summary");
    expect(bundle.session.state.strengths).toEqual(["STATE_SENTINEL"]);
  });

  it("catalogue allowlists assignments and classes without membership/contact data", async () => {
    const repository = new InMemoryTutorRepository();
    repository.reset();
    const offering = (await repository.listStudentOfferings(DEMO_STUDENT_ID))[0];
    Object.assign(offering.assignment, { privateFutureField: "ASSIGNMENT_SENTINEL" });
    Object.assign(offering.teachingClass, { privateFutureField: "CLASS_SENTINEL" });
    const view = studentOfferingView(offering);
    expect(Object.keys(view.teachingClass).sort()).toEqual(["name", "term"]);
    expect(Object.keys(view.assignment).sort()).toEqual(["dueAt", "id", "opensAt"]);
    expect(view.case.attachments).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("SENTINEL");
  });
});
