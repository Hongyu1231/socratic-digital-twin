"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  GraduationCap,
  LoaderCircle,
  Plus,
  RefreshCw,
  School,
  UsersRound,
} from "lucide-react";
import type { CaseAssignment, ClinicalCase, SessionBundle, TeachingClass } from "@/lib/domain";
import styles from "./professor.module.css";

type DashboardTab = "classes" | "assignments" | "reviews";
type AssignmentStatus = "scheduled" | "open" | "closed";

interface ProfessorClass extends TeachingClass {
  isLead?: boolean;
  leadProfessorId?: string | null;
  studentCount?: number;
  professorCount?: number;
  assignmentCount?: number;
}

interface ProfessorAssignment extends Omit<CaseAssignment, "status"> {
  status: AssignmentStatus | "draft";
  closesAt?: string | null;
  class?: ProfessorClass;
  case?: ClinicalCase;
  className?: string;
  caseTitle?: string;
  sessionCount?: number;
  completedCount?: number;
}

interface ReviewQueueItem extends Omit<SessionBundle, "assignment" | "teachingClass"> {
  assignment?: ProfessorAssignment | null;
  teachingClass?: ProfessorClass | null;
  reviewerName?: string | null;
  isClaimedByCurrentProfessor?: boolean;
  canReview?: boolean;
}

interface PublishedCaseSummary extends ClinicalCase {
  version?: number;
  publishedAt?: string | null;
}

interface AssignmentDraft {
  classId: string;
  caseId: string;
  opensAt: string;
  dueAt: string;
}

const EMPTY_DRAFT: AssignmentDraft = { classId: "", caseId: "", opensAt: "", dueAt: "" };

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return "No deadline";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function getClassStudents(item: ProfessorClass) {
  if (typeof item.studentCount === "number") return item.studentCount;
  return item.members.filter((member) => member.role === "student").length;
}

function getClassProfessors(item: ProfessorClass) {
  if (typeof item.professorCount === "number") return item.professorCount;
  return item.members.filter((member) => member.role === "professor").length;
}

function reviewState(bundle: ReviewQueueItem): "in_progress" | "available" | "mine" | "claimed" | "completed" {
  if (bundle.session.status !== "completed") return "in_progress";
  if (bundle.session.reviewStatus === "completed" || bundle.sessionReview?.status === "completed") return "completed";
  if (bundle.reviewClaim?.state === "mine" || bundle.isClaimedByCurrentProfessor) return "mine";
  if (bundle.reviewClaim?.state === "completed") return "completed";
  const reviewerId = bundle.reviewClaim?.reviewerId ?? bundle.sessionReview?.professorId;
  if (bundle.reviewClaim?.state === "other" || reviewerId) return "claimed";
  return "available";
}

const reviewLabels: Record<ReturnType<typeof reviewState>, string> = {
  in_progress: "Student in progress",
  available: "Ready to claim",
  mine: "My draft",
  claimed: "Claimed by colleague",
  completed: "Completed",
};

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

export default function ProfessorDashboard() {
  const [tab, setTab] = useState<DashboardTab>("classes");
  const [classes, setClasses] = useState<ProfessorClass[]>([]);
  const [assignments, setAssignments] = useState<ProfessorAssignment[]>([]);
  const [cases, setCases] = useState<PublishedCaseSummary[]>([]);
  const [sessions, setSessions] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [draft, setDraft] = useState<AssignmentDraft>(EMPTY_DRAFT);
  const [reviewFilter, setReviewFilter] = useState<"all" | "available" | "mine" | "claimed" | "completed">("all");
  const [pending, startTransition] = useTransition();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [classData, assignmentData, sessionData] = await Promise.all([
        fetch("/api/professor/classes", { cache: "no-store" }).then(readJson),
        fetch("/api/professor/assignments", { cache: "no-store" }).then(readJson),
        fetch("/api/professor/sessions", { cache: "no-store" }).then(readJson),
      ]);
      setClasses(Array.isArray(classData) ? classData : classData.classes ?? []);
      setAssignments(Array.isArray(assignmentData) ? assignmentData : assignmentData.assignments ?? []);
      setCases(assignmentData.cases ?? assignmentData.publishedCases ?? []);
      const queue = Array.isArray(sessionData) ? sessionData : sessionData.sessions ?? [];
      setSessions(queue);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Professor workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const stats = useMemo(() => ({
    students: classes.reduce((sum, item) => sum + getClassStudents(item), 0),
    openAssignments: assignments.filter((item) => item.status === "open").length,
    readyReviews: sessions.filter((item) => reviewState(item) === "available").length,
    myDrafts: sessions.filter((item) => reviewState(item) === "mine").length,
  }), [assignments, classes, sessions]);

  const visibleSessions = useMemo(() => sessions.filter((item) => {
    const state = reviewState(item);
    if (reviewFilter === "all") return true;
    return state === reviewFilter;
  }), [reviewFilter, sessions]);

  const assignmentProgress = useMemo(() => {
    const progress = new Map<string, { sessionCount: number; completedCount: number }>();
    for (const bundle of sessions) {
      const assignmentId = bundle.session.assignmentId ?? bundle.assignment?.id;
      if (!assignmentId) continue;
      const current = progress.get(assignmentId) ?? { sessionCount: 0, completedCount: 0 };
      current.sessionCount += 1;
      if (bundle.session.status === "completed") current.completedCount += 1;
      progress.set(assignmentId, current);
    }
    return progress;
  }, [sessions]);

  function createAssignment() {
    if (!draft.classId || !draft.caseId || !draft.opensAt) {
      setError("Choose a class, case and opening time before publishing the assignment.");
      return;
    }
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        const payload = {
          classId: draft.classId,
          caseId: draft.caseId,
          opensAt: new Date(draft.opensAt).toISOString(),
          dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        };
        await fetch("/api/professor/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(readJson);
        setDraft(EMPTY_DRAFT);
        setShowAssignmentForm(false);
        setNotice("Assignment published to the class.");
        await loadDashboard();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Assignment could not be created.");
      }
    });
  }

  function updateAssignment(id: string, status: "open" | "closed") {
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        await fetch("/api/professor/assignments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId: id, status }),
        }).then(readJson);
        setNotice(status === "closed" ? "Assignment closed." : "Assignment reopened.");
        await loadDashboard();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Assignment could not be updated.");
      }
    });
  }

  return (
    <main className={`${styles.workspace} content-shell`}>
      <header className={styles.hero}>
        <div>
          <span className="section-kicker">Faculty workspace</span>
          <h1>Teaching command centre</h1>
          <p>Manage your classes, open learning activities and calibrate each student&apos;s clinical reasoning.</p>
        </div>
        <button className={styles.refreshButton} type="button" onClick={() => void loadDashboard()} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : undefined} /> Refresh data
        </button>
      </header>

      <section className={styles.stats} aria-label="Professor overview">
        <article><UsersRound size={18} /><span>Students</span><strong>{stats.students}</strong><small>Across {classes.length} classes</small></article>
        <article><BookOpenCheck size={18} /><span>Open assignments</span><strong>{stats.openAssignments}</strong><small>{assignments.length} total</small></article>
        <article><ClipboardCheck size={18} /><span>Ready to review</span><strong>{stats.readyReviews}</strong><small>Unclaimed submissions</small></article>
        <article><CircleUserRound size={18} /><span>My drafts</span><strong>{stats.myDrafts}</strong><small>Continue your calibration</small></article>
      </section>

      <nav className={styles.tabs} aria-label="Professor workspace sections">
        <button type="button" className={tab === "classes" ? styles.activeTab : ""} onClick={() => setTab("classes")}><School size={16} /> My classes</button>
        <button type="button" className={tab === "assignments" ? styles.activeTab : ""} onClick={() => setTab("assignments")}><CalendarClock size={16} /> Assignments</button>
        <button type="button" className={tab === "reviews" ? styles.activeTab : ""} onClick={() => setTab("reviews")}><ClipboardCheck size={16} /> Review queue {stats.readyReviews ? <em>{stats.readyReviews}</em> : null}</button>
      </nav>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="success-banner" role="status"><CheckCircle2 size={15} /> {notice}</div> : null}
      {loading ? <div className="empty-state"><LoaderCircle className="spin" /><p>Loading your teaching workspace…</p></div> : null}

      {!loading && tab === "classes" ? (
        <section className={styles.panel} aria-labelledby="classes-heading">
          <div className={styles.panelHeading}><div><span className="section-kicker">My classes</span><h2 id="classes-heading">Teaching groups</h2></div><p>Only classes where you are an assigned professor appear here.</p></div>
          {classes.length === 0 ? <Empty title="No classes assigned" text="Ask an administrator to add you to a teaching class." /> : (
            <div className={styles.classGrid}>{classes.map((item) => {
              const itemAssignments = assignments.filter((assignment) => assignment.classId === item.id);
              const isLead = item.isLead || item.members.some((membership) => membership.isLead);
              return <article className={styles.classCard} key={item.id}>
                <div className={styles.cardTop}><span className={styles.classCode}>{item.code}</span>{isLead ? <span className={styles.leadBadge}><GraduationCap size={12} /> Lead professor</span> : null}</div>
                <h3>{item.name}</h3><p>{item.term || "Current teaching term"}</p>
                <div className={styles.classMetrics}><span><strong>{getClassStudents(item)}</strong> students</span><span><strong>{getClassProfessors(item)}</strong> faculty</span><span><strong>{itemAssignments.length || item.assignmentCount || 0}</strong> activities</span></div>
                <button className={styles.textAction} type="button" onClick={() => { setTab("assignments"); setDraft((current) => ({ ...current, classId: item.id })); }}>Manage assignments <ChevronRight size={14} /></button>
              </article>;
            })}</div>
          )}
        </section>
      ) : null}

      {!loading && tab === "assignments" ? (
        <section className={styles.panel} aria-labelledby="assignments-heading">
          <div className={styles.panelHeading}><div><span className="section-kicker">Assignments</span><h2 id="assignments-heading">Learning activities</h2></div><button className="primary-button" type="button" onClick={() => setShowAssignmentForm((value) => !value)}><Plus size={15} /> New assignment</button></div>
          {showAssignmentForm ? <div className={styles.assignmentForm}>
            <label><span>Class</span><select value={draft.classId} onChange={(event) => setDraft((current) => ({ ...current, classId: event.target.value }))}><option value="">Select a class</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label>
            <label><span>Published case</span><select value={draft.caseId} onChange={(event) => setDraft((current) => ({ ...current, caseId: event.target.value }))}><option value="">Select a case</option>{cases.map((item) => <option value={item.id} key={item.id}>{item.title}{item.version ? ` · v${item.version}` : ""}</option>)}</select></label>
            <label><span>Opens</span><input type="datetime-local" value={draft.opensAt} onChange={(event) => setDraft((current) => ({ ...current, opensAt: event.target.value }))} /></label>
            <label><span>Deadline (optional)</span><input type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))} /></label>
            <div className={styles.formActions}><button type="button" className="secondary-button" onClick={() => { setShowAssignmentForm(false); setDraft(EMPTY_DRAFT); }}>Cancel</button><button type="button" className="primary-button" disabled={pending} onClick={createAssignment}>{pending ? <LoaderCircle size={15} className="spin" /> : <BookOpenCheck size={15} />} Publish</button></div>
          </div> : null}
          {assignments.length === 0 ? <Empty title="No assignments yet" text="Publish a case to one of your classes to begin collecting student sessions." /> : <div className={styles.assignmentList}>{assignments.map((item) => {
            const className = item.class?.name ?? item.className ?? classes.find((entry) => entry.id === item.classId)?.name ?? "Teaching class";
            const caseTitle = item.case?.title ?? item.caseTitle ?? cases.find((entry) => entry.id === item.caseId)?.title ?? "Clinical case";
            const deadline = item.dueAt ?? item.closesAt;
            return <article className={styles.assignmentRow} key={item.id}>
              <div className={styles.assignmentIcon}><BookOpenCheck size={19} /></div><div><div className={styles.rowTitle}><h3>{caseTitle}</h3><span data-status={item.status}>{item.status}</span></div><p>{className} · Opens {formatDate(item.opensAt, true)} · {deadline ? `Due ${formatDate(deadline, true)}` : "No deadline"}</p></div>
              <div className={styles.completion}><strong>{item.completedCount ?? assignmentProgress.get(item.id)?.completedCount ?? 0}/{item.sessionCount ?? assignmentProgress.get(item.id)?.sessionCount ?? 0}</strong><span>completed</span></div>
              <button className={styles.outlineButton} type="button" disabled={pending} onClick={() => updateAssignment(item.id, item.status === "closed" ? "open" : "closed")}>{item.status === "closed" ? "Reopen" : "Close"}</button>
            </article>;
          })}</div>}
        </section>
      ) : null}

      {!loading && tab === "reviews" ? (
        <section className={styles.panel} aria-labelledby="reviews-heading">
          <div className={styles.panelHeading}><div><span className="section-kicker">Review queue</span><h2 id="reviews-heading">Clinical calibration</h2></div><div className={styles.filter} aria-label="Filter review queue">{(["all", "available", "mine", "claimed", "completed"] as const).map((value) => <button type="button" className={reviewFilter === value ? styles.activeFilter : ""} key={value} onClick={() => setReviewFilter(value)}>{value === "all" ? "All" : reviewLabels[value]}</button>)}</div></div>
          {visibleSessions.length === 0 ? <Empty title="Nothing in this queue" text="Completed student sessions will appear here when they match this filter." /> : <div className={styles.reviewList}>{visibleSessions.map((bundle) => {
            const state = reviewState(bundle);
            const className = bundle.teachingClass?.name ?? bundle.assignment?.class?.name ?? "Assigned class";
            const reviewer = bundle.reviewClaim?.reviewerName ?? bundle.reviewerName;
            return <article className={styles.reviewRow} key={bundle.session.id}>
              <div className={styles.studentAvatar}>{bundle.student.name.slice(0, 1)}</div><div><h3>{bundle.student.name}</h3><p>{bundle.case.title} · {className}</p><small>{formatDate(bundle.session.completedAt ?? bundle.session.createdAt, true)}</small></div>
              <div className={styles.score}><strong>{bundle.session.score ?? "—"}</strong><span>AI score</span></div>
              <div><span className={styles.claimBadge} data-state={state}>{reviewLabels[state]}</span>{state === "claimed" && reviewer ? <small className={styles.reviewer}>by {reviewer}</small> : null}</div>
              <Link className={styles.reviewLink} href={`/professor/review/${bundle.session.id}`}>{state === "in_progress" || state === "claimed" ? "View" : state === "completed" ? "Open" : "Review"} <ArrowUpRight size={14} /></Link>
            </article>;
          })}</div>}
        </section>
      ) : null}
    </main>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className={styles.empty}><ClipboardCheck size={27} /><h3>{title}</h3><p>{text}</p></div>;
}
