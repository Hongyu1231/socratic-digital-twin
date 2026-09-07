import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import type { ClinicalCase, SessionBundle } from "@/lib/domain";
import { ArchivedCaseError } from "@/lib/repository/types";

export function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ArchivedCaseError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 410 });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const status = /not found/i.test(message) ? 404 : /belongs|role|required|outside|not available|not a member/i.test(message) ? 403 : /already|changed|conflict|claimed|immutable|published|completed review/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status });
}

/** Allowlist case fields so server-only reference additions never reach students. */
export function studentCaseView(clinicalCase: ClinicalCase): ClinicalCase {
  return {
    id: clinicalCase.id,
    title: clinicalCase.title,
    description: clinicalCase.description,
    difficulty: clinicalCase.difficulty,
    status: clinicalCase.status,
    learningObjectives: clinicalCase.learningObjectives,
    phases: clinicalCase.phases?.map((phase) => ({
      id: phase.id,
      caseId: phase.caseId,
      order: phase.order,
      title: phase.title,
      goal: phase.goal,
      // Keep the public case shape stable without exposing grading criteria,
      // scripted answer matchers, or future teaching questions.
      rubric: [],
      starterQuestion: "",
      exampleQuestions: [],
    })),
    sourceCaseId: clinicalCase.sourceCaseId,
    version: clinicalCase.version,
    publishedAt: clinicalCase.publishedAt,
    attachments: clinicalCase.attachments,
    isTestFixture: clinicalCase.isTestFixture,
  };
}

export function studentView(bundle: SessionBundle): SessionBundle {
  return {
    ...bundle,
    case: studentCaseView(bundle.case),
    session: {
      ...bundle.session,
      evaluations: [],
      state: {
        ...bundle.session.state,
        previousErrors: [],
        weaknesses: [],
      },
    },
    answerReviews: [],
    tutorTurnReviews: [],
    sessionReview: bundle.sessionReview?.status === "completed" ? bundle.sessionReview : null,
  };
}
