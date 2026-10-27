import { hiddenEmailToCode } from "@/lib/account-codes.mjs";
import type { CaseAssignment, SessionBundle, TeachingClass } from "@/lib/domain";
import { activeMilliseconds } from "@/lib/pause-history";
import { reviewPhaseOutcome, type ReviewPhaseOutcome } from "@/lib/phase-outcomes";
import { projectProfessorTranscript } from "@/lib/professor/transcript";

/**
 * Pure projection of one class's pilot data into export rows. No file formats
 * live here: the Excel and Word writers only lay these rows out.
 *
 * Residents are identified by their study code and nothing else. The code
 * comes only from the hidden sign-in email (users.email), never from a name,
 * which admins can edit. Emails, names, user ids and session ids never reach
 * the output.
 */

/** The export can't be made without revealing who someone is. */
export class PilotExportRefusedError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "PilotExportRefusedError";
  }
}

/**
 * Study codes for the class's enrolled students, by user id. Refuses (without
 * naming anyone) if any student has no valid code.
 */
export function studentCodesFor(teachingClass: TeachingClass): Map<string, string> {
  const students = teachingClass.members.filter((member) => member.role === "student");
  const codes = new Map<string, string>();
  let missing = 0;
  for (const member of students) {
    const code = hiddenEmailToCode(member.user?.email);
    if (code) codes.set(member.userId, code);
    else missing += 1;
  }
  if (missing) {
    const who = missing === 1 ? "1 student" : `${missing} students`;
    throw new PilotExportRefusedError(`This class has ${who} without a study code, so the data can't be exported anonymously. Ask an admin to give every resident a code account first.`);
  }
  return codes;
}

export const EXPORT_TIME_ZONE = "Asia/Singapore";

export type SessionOutcome = "completed" | "ended_early" | "in_progress";

export const STATUS_LABELS: Record<SessionOutcome, string> = {
  completed: "Completed",
  ended_early: "Ended early",
  in_progress: "Still in progress",
};

export const PHASE_OUTCOME_LABELS: Record<ReviewPhaseOutcome, string> = {
  independent: "Did it on their own",
  with_support: "Tutor walked them through it",
  not_completed: "Didn't finish this phase",
};


export interface PhaseOutcomeCell {
  order: number;
  title: string;
  outcome: ReviewPhaseOutcome;
  label: string;
}

export interface SummaryRow {
  code: string;
  attempt: number;
  caseTitle: string;
  startedAt: Date;
  startedText: string;
  finishedAt: Date | null;
  finishedText: string;
  /**
   * Minutes (one decimal place) from start to finish (or to the last message while still in
   * progress), minus every recorded pause.
   */
  timeSpentMinutes: number;
  /** Longest stretch between two messages, minus pauses; null with fewer than two messages. */
  longestGapMinutes: number | null;
  /** Paused right now with no pause history: only that current pause is known. */
  earlierPausesUnknown: boolean;
  status: SessionOutcome;
  statusLabel: string;
  aiScore: number | null;
  phases: PhaseOutcomeCell[];
  helpRequests: number;
  /** Word file name for this session, e.g. R03.docx or R03-attempt-2.docx. */
  fileName: string;
}

export type Speaker = "Tutor" | "Resident";
export type HelpMarker = "" | "Asked for help" | "Tutor's reply to a help request";

export interface TranscriptRow {
  code: string;
  attempt: number;
  caseTitle: string;
  phaseOrder: number;
  phaseTitle: string;
  messageNumber: number;
  speaker: Speaker;
  text: string;
  sentAt: Date;
  sentText: string;
  help: HelpMarker;
}

export interface SessionRecord {
  summary: SummaryRow;
  messages: TranscriptRow[];
}

export interface PilotExport {
  className: string;
  classCode: string;
  exportedAt: Date;
  exportedText: string;
  /** yyyy-mm-dd in Singapore time, for file names. */
  exportDate: string;
  /** True when any session is paused with no pause history (see Notes). */
  anyEarlierPausesUnknown: boolean;
  /** Phase column headers, one per phase of the longest case in the export. */
  phaseColumns: Array<{ order: number; title: string | null }>;
  summary: SummaryRow[];
  transcripts: TranscriptRow[];
  sessions: SessionRecord[];
}

export interface PilotExportInput {
  teachingClass: TeachingClass;
  assignments: CaseAssignment[];
  /** Any sessions; anything outside this class's students and assignments is dropped. */
  sessions: SessionBundle[];
  exportedAt: Date;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: EXPORT_TIME_ZONE,
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** dd MMM yyyy HH:mm in Singapore time, e.g. "05 Nov 2026 14:30". */
export function formatSingaporeTime(date: Date): string {
  const parts = Object.fromEntries(dateTimeFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`;
}

/** yyyy-mm-dd in Singapore time. */
export function singaporeDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EXPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function sessionOutcome(bundle: SessionBundle): SessionOutcome {
  const { session } = bundle;
  if (session.status === "active") return "in_progress";
  if (session.status === "abandoned") return "ended_early";
  if (session.summary) return session.summary.completedAllPhases ? "completed" : "ended_early";
  // A completed row without a summary: fall back to the recorded phase progress.
  const allDone = bundle.case.phases.every((phase) => session.state.phaseProgress?.[String(phase.order)]?.completed);
  return allDone ? "completed" : "ended_early";
}

/** Minutes to one decimal place, e.g. 17.4. */
const toTenthsOfMinute = (milliseconds: number) => Math.round(milliseconds / 6000) / 10;

function activeMinutes(bundle: SessionBundle, start: Date, end: Date, inProgress: boolean) {
  const history = bundle.session.pauseHistory ?? [];
  return toTenthsOfMinute(activeMilliseconds(start, end, history, inProgress ? bundle.session.pausedAt : null));
}

/** The longest wait between consecutive messages, not counting pauses. */
function longestGapMinutes(bundle: SessionBundle): number | null {
  const times = bundle.session.messages.map((message) => new Date(message.timestamp));
  if (times.length < 2) return null;
  const history = bundle.session.pauseHistory ?? [];
  let longest = 0;
  for (let index = 1; index < times.length; index += 1) {
    longest = Math.max(longest, activeMilliseconds(times[index - 1]!, times[index]!, history));
  }
  return toTenthsOfMinute(longest);
}

function safeFileStem(code: string) {
  const printable = [...code.normalize("NFKC")].map((char) => char.charCodeAt(0) < 32 ? " " : char).join("");
  const stem = printable.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return stem || "Resident";
}

const codeCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function buildPilotExport(input: PilotExportInput): PilotExport {
  const { teachingClass, exportedAt } = input;
  const assignments = new Map(input.assignments
    .filter((assignment) => assignment.classId === teachingClass.id)
    .map((assignment) => [assignment.id, assignment]));
  const studentCodes = studentCodesFor(teachingClass);

  const included = input.sessions.filter((bundle) =>
    bundle.session.assignmentId
    && assignments.has(bundle.session.assignmentId)
    && studentCodes.has(bundle.session.studentId)
    && bundle.student.role === "student");

  // Attempt number per resident per assignment, by start time.
  const byStart = [...included].sort((a, b) => a.session.createdAt.localeCompare(b.session.createdAt) || a.session.id.localeCompare(b.session.id));
  const attemptCounters = new Map<string, number>();
  const attempts = new Map<string, number>();
  for (const bundle of byStart) {
    const key = `${bundle.session.studentId}:${bundle.session.assignmentId}`;
    const attempt = (attemptCounters.get(key) ?? 0) + 1;
    attemptCounters.set(key, attempt);
    attempts.set(bundle.session.id, attempt);
  }

  const codeFor = (bundle: SessionBundle) => studentCodes.get(bundle.session.studentId)!;
  const ordered = byStart.sort((a, b) =>
    codeCollator.compare(codeFor(a), codeFor(b))
    || a.session.createdAt.localeCompare(b.session.createdAt)
    || a.session.id.localeCompare(b.session.id));

  // A resident with sessions on more than one case gets the case in each file name.
  const casesPerCode = new Map<string, Set<string>>();
  for (const bundle of ordered) {
    const code = codeFor(bundle);
    casesPerCode.set(code, (casesPerCode.get(code) ?? new Set()).add(bundle.session.assignmentId!));
  }
  const usedFileNames = new Set<string>();
  const sessions: SessionRecord[] = ordered.map((bundle) => {
    const { session } = bundle;
    const code = codeFor(bundle);
    const attempt = attempts.get(session.id)!;
    const caseTitle = bundle.case.title;
    const startedAt = new Date(session.createdAt);
    const status = sessionOutcome(bundle);
    const finishedAt = status !== "in_progress" && session.completedAt ? new Date(session.completedAt) : null;
    const phases = [...bundle.case.phases].sort((a, b) => a.order - b.order).map((phase) => {
      const outcome = reviewPhaseOutcome(session.state.phaseProgress?.[String(phase.order)]);
      return { order: phase.order, title: phase.title, outcome, label: PHASE_OUTCOME_LABELS[outcome] };
    });
    // Unfinished sessions, and ended ones with no finish time, stop at their last message.
    const lastActivity = new Date(session.messages.at(-1)?.timestamp ?? session.createdAt);
    const phaseTitle = (order: number) => phases.find((phase) => phase.order === order)?.title ?? "";

    // Help turns come from the same projection the review page uses.
    const turns = projectProfessorTranscript(session);
    const helpTurns = turns.filter((turn) => turn.kind === "help");
    const helpAsks = new Set(helpTurns.map((turn) => turn.marker.id));
    const helpReplies = new Set(helpTurns.flatMap((turn) => turn.tutorReply ? [turn.tutorReply.id] : []));

    let currentPhase = phases[0]?.order ?? 1;
    const messages: TranscriptRow[] = session.messages.map((message, index) => {
      currentPhase = message.phaseOrder ?? currentPhase;
      // The tutor message that closes a phase carries the old phase's number but
      // opens the next one (acknowledgement plus its opening question), so it
      // belongs there. The final "all phases done" message has no next phase.
      if (message.sender === "ai" && message.moveType === "transition" && phases.some((phase) => phase.order === currentPhase + 1)) {
        currentPhase += 1;
      }
      const sentAt = new Date(message.timestamp);
      return {
        code, attempt, caseTitle,
        phaseOrder: currentPhase,
        phaseTitle: phaseTitle(currentPhase),
        messageNumber: index + 1,
        speaker: message.sender === "ai" ? "Tutor" : "Resident",
        text: message.content,
        sentAt,
        sentText: formatSingaporeTime(sentAt),
        help: helpAsks.has(message.id) ? "Asked for help" : helpReplies.has(message.id) ? "Tutor's reply to a help request" : "",
      };
    });

    const base = (casesPerCode.get(code)?.size ?? 1) > 1 ? `${code}, ${caseTitle}` : code;
    const stem = safeFileStem(attempt > 1 ? `${base}-attempt-${attempt}` : base);
    let fileName = `${stem}.docx`;
    for (let copy = 2; usedFileNames.has(fileName.toLowerCase()); copy += 1) fileName = `${stem}-${copy}.docx`;
    usedFileNames.add(fileName.toLowerCase());

    return {
      summary: {
        code, attempt, caseTitle,
        startedAt, startedText: formatSingaporeTime(startedAt),
        finishedAt, finishedText: finishedAt ? formatSingaporeTime(finishedAt) : "",
        timeSpentMinutes: activeMinutes(bundle, startedAt, finishedAt ?? lastActivity, status === "in_progress"),
        longestGapMinutes: longestGapMinutes(bundle),
        earlierPausesUnknown: status === "in_progress" && Boolean(session.pausedAt) && !(session.pauseHistory?.length),
        status, statusLabel: STATUS_LABELS[status],
        aiScore: typeof session.score === "number" ? session.score : null,
        phases,
        helpRequests: helpTurns.length,
        fileName,
      },
      messages,
    };
  });

  // One column per phase of the longest case. Titles are used only when
  // every case in the export agrees on that phase's title.
  const phaseCount = Math.max(0, ...sessions.map((record) => record.summary.phases.length));
  const phaseColumns = Array.from({ length: phaseCount }, (_, index) => {
    const titles = new Set(sessions.flatMap((record) => record.summary.phases[index] ? [record.summary.phases[index]!.title] : []));
    return { order: index + 1, title: titles.size === 1 ? [...titles][0]! : null };
  });

  return {
    className: teachingClass.name,
    classCode: teachingClass.code,
    exportedAt,
    exportedText: formatSingaporeTime(exportedAt),
    exportDate: singaporeDate(exportedAt),
    anyEarlierPausesUnknown: sessions.some((record) => record.summary.earlierPausesUnknown),
    phaseColumns,
    summary: sessions.map((record) => record.summary),
    transcripts: sessions.flatMap((record) => record.messages),
    sessions,
  };
}

/** "1 hr 05 min" style for people reading a document. */
export function describeMinutes(exactMinutes: number): string {
  const minutes = Math.round(exactMinutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (minutes === 0) return "Less than a minute";
  if (hours === 0) return `${rest} min`;
  return `${hours} hr ${rest} min`;
}
