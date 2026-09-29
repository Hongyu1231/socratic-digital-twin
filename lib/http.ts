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
export function studentCaseView(clinicalCase: ClinicalCase, currentPhase?: number): ClinicalCase {
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
    // The catalogue has no session phase, so it receives no media references.
    // Private object keys are never exposed, even before URL signing occurs.
    attachments: currentPhase === undefined ? [] : (clinicalCase.attachments ?? [])
      .filter((item) => (item.unlockPhase ?? 1) <= currentPhase)
      .map(({ id, kind, title, description, url, posterUrl, transcript, sourceLabel, sourceUrl, unlockPhase, storagePath }) => ({
        id, kind, title, description, transcript, sourceLabel, unlockPhase: unlockPhase ?? 1,
        ...(!storagePath ? { url, posterUrl, sourceUrl } : {}),
      })),
    findings: currentPhase === undefined ? [] : (clinicalCase.findings ?? [])
      .filter((item) => item.unlockPhase <= currentPhase)
      .map(({ id, title, text, unlockPhase }) => ({ id, title, text, unlockPhase })),
    isTestFixture: clinicalCase.isTestFixture,
  };
}

export function studentView(bundle: SessionBundle): SessionBundle {
  const publicCase = studentCaseView(bundle.case, bundle.session.currentPhase);
  return {
    ...bundle,
    case: {
      ...publicCase,
      phases: publicCase.phases.map((phase) => ({
        ...phase,
        phaseProgress: {
          criteriaMet: bundle.session.state.phaseProgress?.[String(phase.order)]?.criteriaMet.length ?? 0,
          criteriaTotal: bundle.case.phases.find((item) => item.id === phase.id)?.rubric.length ?? 0,
          completedWithSupport: bundle.session.state.phaseProgress?.[String(phase.order)]?.completedWithSupport ?? false,
        },
      })),
    },
    session: {
      ...bundle.session,
      evaluations: [],
      state: {
        ...bundle.session.state,
        previousErrors: [],
        weaknesses: [],
        // Internal phase provenance includes the same private gaps/errors.
        phaseEvidence: undefined,
        phaseProgress: undefined,
        reflectionAsked: undefined,
        reflectionAnswered: undefined,
        usedTutorMoves: undefined,
      },
    },
    answerReviews: [],
    tutorTurnReviews: [],
    sessionReview: bundle.sessionReview?.status === "completed" ? bundle.sessionReview : null,
  };
}
