import type {
  CaseAttachment, CasePhase, ClinicalCase, ClinicalFinding, LearningSession,
  SessionBundle, SessionSummary, StudentCaseOffering, TutorMessage,
} from "@/lib/domain";

/** Deliberately separate wire types: server-only fields cannot become UI dependencies. */
export type StudentPhase = Pick<CasePhase, "id" | "order" | "title" | "goal" | "phaseProgress">;
export type StudentAttachment = Pick<CaseAttachment,
  "id" | "kind" | "title" | "description" | "url" | "posterUrl" | "transcript" |
  "sourceLabel" | "sourceUrl" | "unlockPhase" | "expiresAt">;
export type StudentCase = Pick<ClinicalCase,
  "id" | "title" | "description" | "difficulty" | "status" | "learningObjectives" | "version"> & {
    phases: StudentPhase[];
    attachments: StudentAttachment[];
    findings: Pick<ClinicalFinding, "id" | "title" | "text" | "unlockPhase">[];
  };
export interface StudentSessionBundle {
  session: Pick<LearningSession, "id" | "caseId" | "currentPhase" | "status" | "pausedAt"> & {
    messages: TutorMessage[];
    summary: SessionSummary | null;
  };
  case: StudentCase;
  runtime: Pick<SessionBundle["runtime"], "tutor" | "fallbackFrom">;
  summaryGenerationStatus: SessionBundle["summaryGenerationStatus"];
}
export interface StudentOffering {
  assignment: Pick<StudentCaseOffering["assignment"], "id" | "opensAt" | "dueAt">;
  teachingClass: Pick<StudentCaseOffering["teachingClass"], "name" | "term">;
  case: StudentCase;
  existingSessionId: StudentCaseOffering["existingSessionId"];
  existingSessionStatus: StudentCaseOffering["existingSessionStatus"];
  existingSessionPausedAt: StudentCaseOffering["existingSessionPausedAt"];
  availability: StudentCaseOffering["availability"];
}
