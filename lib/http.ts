import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import type { ClinicalCase, SessionBundle, SessionSummary, StudentCaseOffering } from "@/lib/domain";
import type { StudentCase, StudentOffering, StudentSessionBundle } from "@/lib/student-contract";
import { ArchivedCaseError, AssignmentIdempotencyConflictError, SupersededCaseError } from "@/lib/repository/types";
import { StaffSessionCursorError } from "@/lib/repository/staff-session";
import { canRequestHelp } from "@/lib/tutor/state-machine";

export function errorResponse(error: unknown) {
  if (error instanceof AssignmentIdempotencyConflictError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
  }
  if (error instanceof StaffSessionCursorError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ArchivedCaseError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 410 });
  }
  if (error instanceof SupersededCaseError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 410 });
  }
  if (error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true) {
    const message = error instanceof Error ? error.message : "This request can be retried.";
    const code = "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "RETRYABLE_ERROR";
    return NextResponse.json({ error: message, code }, { status: 503 });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const status = /not found/i.test(message) ? 404 : /belongs|role|required|outside|not available|not a member/i.test(message) ? 403 : /already|changed|conflict|claimed|immutable|published|completed review/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status });
}

/** Allowlist case fields so server-only reference additions never reach students. */
export function studentCaseView(clinicalCase: ClinicalCase, currentPhase?: number): StudentCase {
  return {
    id: clinicalCase.id,
    title: clinicalCase.title,
    description: clinicalCase.description,
    difficulty: clinicalCase.difficulty,
    status: clinicalCase.status,
    learningObjectives: clinicalCase.learningObjectives,
    phases: clinicalCase.phases?.map((phase) => ({
      id: phase.id,
      order: phase.order,
      title: phase.title,
      goal: phase.goal,
    })),
    version: clinicalCase.version,
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
  };
}

function summaryView(summary: SessionSummary | null): SessionSummary | null {
  if (!summary) return null;
  return {
    overallScore: summary.overallScore, headline: summary.headline, narrative: summary.narrative,
    strengths: [...summary.strengths], weaknesses: [...summary.weaknesses], nextSteps: [...summary.nextSteps],
    completedAllPhases: summary.completedAllPhases,
    supportedPhases: summary.supportedPhases ? [...summary.supportedPhases] : undefined,
  };
}

export function studentOfferingView(offering: StudentCaseOffering): StudentOffering {
  return {
    assignment: { id: offering.assignment.id, opensAt: offering.assignment.opensAt, dueAt: offering.assignment.dueAt },
    teachingClass: { name: offering.teachingClass.name, term: offering.teachingClass.term },
    case: studentCaseView(offering.case),
    existingSessionId: offering.existingSessionId,
    existingSessionStatus: offering.existingSessionStatus,
    existingSessionPausedAt: offering.existingSessionPausedAt,
    availability: offering.availability,
  };
}

export function studentView(bundle: SessionBundle): StudentSessionBundle {
  const publicCase = studentCaseView(bundle.case, bundle.session.currentPhase);
  return {
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
      id: bundle.session.id,
      caseId: bundle.session.caseId,
      currentPhase: bundle.session.currentPhase,
      status: bundle.session.status,
      pausedAt: bundle.session.pausedAt,
      canRequestHelp: canRequestHelp(bundle),
      messages: bundle.session.messages.map((message) => {
        // Legacy opening/system tutor rows are standalone transcript entries;
        // only paired turns receive answer/false compatibility defaults.
        const paired = message.sender === "student" || message.replyToMessageId !== undefined;
        const turnKind = message.turnKind ?? (paired ? "answer" : undefined);
        const helpRequested = message.helpRequested ?? (turnKind ? false : undefined);
        return {
          id: message.id, sessionId: message.sessionId, sender: message.sender,
          content: message.content, timestamp: message.timestamp,
          replyToMessageId: message.replyToMessageId, acknowledgement: message.acknowledgement,
          moveType: message.moveType,
          turnKind,
          helpRequested,
        };
      }),
      summary: summaryView(bundle.session.summary),
    },
    runtime: { tutor: bundle.runtime.tutor, fallbackFrom: bundle.runtime.fallbackFrom },
    summaryGenerationStatus: bundle.summaryGenerationStatus,
  };
}
