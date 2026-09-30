"use client";

import {
  Activity,
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  ClipboardCheck,
  Copy,
  GraduationCap,
  LayoutDashboard,
  LoaderCircle,
  Minus,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  School,
  Send,
  ShieldCheck,
  FlaskConical,
  UserCog,
  UsersRound,
  X,
} from "lucide-react";
import FeedbackLab from "./feedback-lab";
import { cloneElement, FormEvent, isValidElement, ReactNode, type ReactElement, useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  CASE_DESCRIPTION_MAX_LENGTH,
  CASE_TITLE_MAX_LENGTH,
  caseActionPolicy,
  MEDIA_URL_MAX_LENGTH,
  cloneCaseDraft,
  clonePhase,
  diagnosticsForCase,
  diagnosticsForDraft,
  normalizeDiagnostics,
  serializeCaseDraft,
} from "./case-editor";
import type {
  CaseAttachmentDiagnostic,
  CaseAttachmentDraft,
  CaseFindingDraft,
  CasePhaseDraft,
  CaseStatus,
  CaseVersionDraft,
  RubricCriterionDraft,
} from "./case-editor";

type AdminTab = "overview" | "users" | "classes" | "cases" | "activity" | "feedback";
type Role = "student" | "professor" | "admin";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive?: boolean;
  is_active?: boolean;
  classes?: Array<{ id: string; name: string }>;
}

interface ClassMember {
  userId?: string;
  user_id?: string;
  role?: Role;
  isLead?: boolean;
  is_lead?: boolean;
  user?: AdminUser;
}

interface TeachingClass {
  id: string;
  name: string;
  code: string;
  term?: string;
  semester?: string;
  status?: "active" | "archived";
  memberships?: ClassMember[];
  members?: ClassMember[];
  studentCount?: number;
  professorCount?: number;
}

type CaseVersion = Omit<CaseVersionDraft, "id" | "status"> & { id: string; status: CaseStatus };

interface AdminSession {
  id?: string;
  session?: {
    id: string;
    status: string;
    reviewStatus?: string;
    review_status?: string;
    score?: number | null;
    professorId?: string | null;
    professor_id?: string | null;
    createdAt?: string;
    created_at?: string;
  };
  student?: AdminUser;
  case?: CaseVersion;
  class?: TeachingClass;
  className?: string;
  assignment?: { class?: TeachingClass };
  teachingClass?: TeachingClass | null;
  reviewer?: AdminUser | null;
  reviewClaim?: { reviewerId?: string | null; reviewerName?: string | null };
}

interface OverviewData {
  users?: number | Record<string, number>;
  userCount?: number;
  classes?: number;
  classCount?: number;
  openAssignments?: number;
  openAssignmentCount?: number;
  activeAssignments?: number;
  sessions?: number;
  sessionCount?: number;
  pendingReviews?: number;
  pendingReviewCount?: number;
  completionRate?: number;
}

interface DashboardData {
  overview: OverviewData;
  users: AdminUser[];
  classes: TeachingClass[];
  cases: CaseVersion[];
  sessions: AdminSession[];
  diagnostics: CaseAttachmentDiagnostic[];
}

const EMPTY_DATA: DashboardData = { overview: {}, users: [], classes: [], cases: [], sessions: [], diagnostics: [] };
const TABS: Array<{ id: AdminTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: UserCog },
  { id: "classes", label: "Classes", icon: School },
  { id: "cases", label: "Cases", icon: BookOpen },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "feedback", label: "Tutor improvement lab", icon: FlaskConical },
];

const MAX_PHASES = 12;

function blankPhase(index: number): CasePhaseDraft {
  return {
    order: index + 1,
    title: `Phase ${index + 1}`,
    goal: "",
    rubric: [""],
    starterQuestion: "",
    exampleQuestions: [""],
    tutorGuidance: [],
    tutorMoves: [],
  };
}

const DEFAULT_PHASES: CasePhaseDraft[] = Array.from({ length: 5 }, (_, index) => blankPhase(index));

function unwrapList<T>(value: unknown, keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as T[];
  return [];
}

function readError(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") return value.error;
  return fallback;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new Error(readError(body, `Request failed (${response.status}).`));
  return body as T;
}

function isActive(user: AdminUser) {
  return user.isActive ?? user.is_active ?? true;
}

function memberships(item: TeachingClass) {
  return item.memberships ?? item.members ?? [];
}

function memberId(item: ClassMember) {
  return item.userId ?? item.user_id ?? item.user?.id ?? "";
}

function memberLead(item: ClassMember) {
  return item.isLead ?? item.is_lead ?? false;
}

function sessionValue(item: AdminSession) {
  return item.session ?? {
    id: item.id ?? "",
    status: "active",
  };
}

function reviewStatus(item: AdminSession) {
  const session = sessionValue(item);
  return session.reviewStatus ?? session.review_status ?? "pending";
}

function reviewerId(item: AdminSession) {
  const session = sessionValue(item);
  return item.reviewClaim?.reviewerId ?? item.reviewer?.id ?? session.professorId ?? session.professor_id ?? "";
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const generatedId = `admin-field-${useId().replace(/:/g, "")}`;
  const isNativeControl = isValidElement(children)
    && typeof children.type === "string"
    && ["input", "select", "textarea"].includes(children.type);
  const nativeChild = isNativeControl ? children as ReactElement<{ id?: string; "aria-describedby"?: string }> : undefined;
  const childProps = nativeChild?.props;
  const controlId = isNativeControl ? childProps?.id ?? generatedId : undefined;
  const hintId = hint && controlId ? `${controlId}-hint` : undefined;
  const control = isNativeControl
    ? cloneElement(nativeChild!, {
      id: controlId,
      ...(hintId ? { "aria-describedby": [childProps?.["aria-describedby"], hintId].filter(Boolean).join(" ") } : {}),
    })
    : children;
  return (
    <div className="grid gap-1.5 text-xs font-bold text-[#4e263f]">
      <label htmlFor={controlId}>{label}</label>
      {control}
      {hint ? <small id={hintId} className="font-normal text-[#726c73]">{hint}</small> : null}
    </div>
  );
}

const inputClass = "w-full rounded-lg border border-[#ded8d0] bg-white px-3 py-2.5 text-sm text-[#21172b] outline-none transition focus:border-[#de695c] focus:ring-2 focus:ring-[#de695c]/15 disabled:bg-[#ece7de] disabled:text-[#726c73]";
const panelClass = "rounded-[3px_22px_3px_3px] border border-[#ded8d0] bg-[#fffdfa] shadow-[0_16px_45px_rgba(48,28,43,.06)]";

export default function AdminDashboard() {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const requests = await Promise.allSettled([
      api<unknown>("/api/admin/overview"),
      api<unknown>("/api/admin/users"),
      api<unknown>("/api/admin/classes"),
      api<unknown>("/api/admin/cases"),
      api<unknown>("/api/admin/sessions"),
    ]);
    const caseResponse = requests[3].status === "fulfilled" ? requests[3].value : undefined;
    setData({
      overview: requests[0].status === "fulfilled"
        ? ((requests[0].value as { overview?: OverviewData }).overview ?? requests[0].value as OverviewData)
        : {},
      users: requests[1].status === "fulfilled" ? unwrapList(requests[1].value, ["users"]) : [],
      classes: requests[2].status === "fulfilled" ? unwrapList(requests[2].value, ["classes"]) : [],
      cases: unwrapList(caseResponse, ["cases"]),
      sessions: requests[4].status === "fulfilled" ? unwrapList(requests[4].value, ["sessions"]) : [],
      diagnostics: normalizeDiagnostics(caseResponse && typeof caseResponse === "object" ? (caseResponse as { diagnostics?: unknown }).diagnostics : undefined),
    });
    const failures = requests.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failures.length) setError(failures.map((item) => item.reason instanceof Error ? item.reason.message : "Data could not be loaded.").join(" "));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function mutate(label: string, action: () => Promise<unknown>, success: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The change could not be saved.");
      return false;
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="min-h-[calc(100vh-76px)] bg-[#f6f3ed]">
      <div className="mx-auto grid w-[min(1440px,100%)] grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="border-b border-[#ded8d0] bg-[#21172b] px-5 py-5 text-white lg:sticky lg:top-[76px] lg:h-[calc(100vh-76px)] lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-9">
          <div className="mb-6 hidden px-3 lg:block">
            <span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#e7aca2]">Operations</span>
            <h1 className="mt-2 font-serif text-2xl">Admin workspace</h1>
            <p className="mt-2 text-xs leading-5 text-white/55">Manage the people, cohorts and teaching content behind every learning journey.</p>
          </div>
          <nav className="flex gap-2 overflow-x-auto lg:grid" aria-label="Admin sections">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                style={tab === id ? { color: "#4e263f" } : undefined}
                className={`flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ${tab === id ? "bg-white" : "text-white/65 hover:bg-white/10 hover:text-white"}`}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </nav>
          <div className="mt-8 hidden rounded-xl border border-white/10 p-4 lg:block">
            <ShieldCheck className="text-[#e7aca2]" size={20} />
            <strong className="mt-3 block font-serif text-sm">Server-controlled access</strong>
            <p className="mt-1 text-[10px] leading-4 text-white/50">Changes are authorized by the signed admin identity and persisted through the server repository.</p>
          </div>
        </aside>

        <section className="min-w-0 px-5 py-8 md:px-9 lg:px-12 lg:py-11">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="section-kicker">Teaching operations</span>
              <h2 className="mt-2 font-serif text-4xl tracking-[-.035em] text-[#21172b] md:text-5xl">{TABS.find((item) => item.id === tab)?.label}</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
              <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>

          {error ? <div className="error-banner mb-5 mt-0" role="alert">{error}</div> : null}
          {notice ? <div className="success-banner" role="status"><Check size={15} /> {notice}</div> : null}
          {loading ? <div className="empty-state"><LoaderCircle className="spin mx-auto" /><p>Loading administration data…</p></div> : null}
          {!loading && tab === "overview" ? <Overview data={data} setTab={setTab} /> : null}
          {!loading && tab === "users" ? <Users data={data} busy={busy} mutate={mutate} /> : null}
          {!loading && tab === "classes" ? <Classes data={data} busy={busy} mutate={mutate} /> : null}
          {!loading && tab === "cases" ? <Cases data={data} busy={busy} mutate={mutate} setError={setError} /> : null}
          {!loading && tab === "activity" ? <ActivityView data={data} busy={busy} mutate={mutate} /> : null}
          {!loading && tab === "feedback" ? <FeedbackLab /> : null}
        </section>
      </div>
    </main>
  );
}

function Overview({ data, setTab }: { data: DashboardData; setTab: (tab: AdminTab) => void }) {
  const counts = {
    users: data.overview.userCount ?? (typeof data.overview.users === "number" ? data.overview.users : data.users.length),
    classes: data.overview.classCount ?? data.overview.classes ?? data.classes.length,
    assignments: data.overview.openAssignmentCount ?? data.overview.openAssignments ?? data.overview.activeAssignments ?? 0,
    sessions: data.overview.sessionCount ?? data.overview.sessions ?? data.sessions.length,
    reviews: data.overview.pendingReviewCount ?? data.overview.pendingReviews ?? data.sessions.filter((item) => reviewStatus(item) !== "completed").length,
  };
  const completionRate = data.overview.completionRate ?? (counts.sessions > 0
    ? Math.round((data.sessions.filter((item) => item.session?.status === "completed").length / counts.sessions) * 100)
    : 0);
  const roleCounts = typeof data.overview.users === "object" ? data.overview.users : undefined;
  const cards = [
    { label: "Active users", value: counts.users, icon: UsersRound, note: roleCounts ? `${roleCounts.student ?? 0} students · ${roleCounts.professor ?? 0} faculty` : "Across all teaching roles" },
    { label: "Teaching classes", value: counts.classes, icon: School, note: "Active and archived cohorts" },
    { label: "Open assignments", value: counts.assignments, icon: BookOpen, note: "Available to enrolled students" },
    { label: "Learning sessions", value: counts.sessions, icon: GraduationCap, note: `${completionRate}% completion rate` },
    { label: "Pending reviews", value: counts.reviews, icon: ClipboardCheck, note: "Awaiting faculty calibration" },
  ];
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Administrative overview">
        {cards.map(({ label, value, icon: Icon, note }) => (
          <article className={`${panelClass} p-5`} key={label}>
            <div className="flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#726c73]">{label}</span><Icon size={17} className="text-[#de695c]" /></div>
            <strong className="mt-3 block font-serif text-4xl font-normal">{value}</strong>
            <small className="mt-2 block text-[10px] leading-4 text-[#726c73]">{note}</small>
          </article>
        ))}
      </section>
      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <article className={`${panelClass} p-6`}>
          <span className="section-kicker">Workflow</span>
          <h3 className="mt-2 font-serif text-2xl">Teaching operations at a glance</h3>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[{ title: "Organise", text: "Create cohorts and appoint lead faculty.", tab: "classes" as const }, { title: "Publish", text: "Author and version flexible teaching cases.", tab: "cases" as const }, { title: "Calibrate", text: "Monitor sessions and review ownership.", tab: "activity" as const }].map((item, index) => (
              <button type="button" key={item.title} onClick={() => setTab(item.tab)} className="rounded-xl border border-[#ded8d0] p-4 text-left transition hover:border-[#de695c] hover:bg-[#f6f3ed]">
                <span className="font-mono text-[10px] text-[#de695c]">0{index + 1}</span><strong className="mt-2 block font-serif">{item.title}</strong><small className="mt-1 block leading-4 text-[#726c73]">{item.text}</small>
              </button>
            ))}
          </div>
        </article>
        <article className={`${panelClass} p-6`}>
          <span className="section-kicker">System state</span>
          <h3 className="mt-2 font-serif text-2xl">Content readiness</h3>
          <div className="mt-5 grid gap-3 text-xs">
            <div className="flex justify-between border-b border-[#ded8d0] pb-3"><span className="text-[#726c73]">Published cases</span><strong>{data.cases.filter((item) => item.status === "published" || item.status === "available").length}</strong></div>
            <div className="flex justify-between border-b border-[#ded8d0] pb-3"><span className="text-[#726c73]">Draft cases</span><strong>{data.cases.filter((item) => item.status === "draft").length}</strong></div>
            <div className="flex justify-between"><span className="text-[#726c73]">Unclaimed reviews</span><strong>{data.sessions.filter((item) => reviewStatus(item) !== "completed" && !reviewerId(item)).length}</strong></div>
          </div>
        </article>
      </section>
    </div>
  );
}

function Users({ data, busy, mutate }: { data: DashboardData; busy: string; mutate: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  const [filter, setFilter] = useState<"all" | Role>("all");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const shown = data.users.filter((user) => filter === "all" || user.role === filter);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const ok = await mutate(`user-${editing.id}`, () => api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userId: editing.id, name: editing.name, email: editing.email, isActive: isActive(editing) }) }), "User profile updated.");
    if (ok) setEditing(null);
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter users by role">
          {(["all", "student", "professor", "admin"] as const).map((role) => <button key={role} type="button" onClick={() => setFilter(role)} className={`rounded-full border px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.1em] ${filter === role ? "border-[#4e263f] bg-[#4e263f] text-white" : "border-[#ded8d0] bg-white text-[#726c73]"}`}>{role}</button>)}
        </div>
        <span className="text-xs text-[#726c73]">{shown.length} users</span>
      </div>
      <section className={`${panelClass} overflow-x-auto`}>
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[1.35fr_1.5fr_.7fr_.7fr_100px] gap-4 bg-[#ece7de] px-5 py-3 text-[9px] font-extrabold uppercase tracking-[.12em] text-[#726c73]"><span>User</span><span>Email</span><span>Role</span><span>Status</span><span>Action</span></div>
          {shown.map((user) => (
            <div key={user.id} className="grid min-h-20 grid-cols-[1.35fr_1.5fr_.7fr_.7fr_100px] items-center gap-4 border-t border-[#ded8d0] px-5 py-3 text-xs">
              <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-[#e5ede7] font-serif text-[#476555]">{user.name.slice(0, 1)}</span><div><strong className="font-serif text-sm">{user.name}</strong><small className="block text-[10px] text-[#726c73]">{user.classes?.map((item) => item.name).join(", ") || data.classes.filter((item) => memberships(item).some((member) => memberId(member) === user.id)).map((item) => item.name).join(", ") || "No class shown"}</small></div></div>
              <span className="text-[#726c73]">{user.email}</span>
              <span className="capitalize">{user.role}</span>
              <span className={`w-fit rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.1em] ${isActive(user) ? "bg-[#e5ede7] text-[#476555]" : "bg-[#ece7de] text-[#726c73]"}`}>{isActive(user) ? "Active" : "Inactive"}</span>
              <button className="table-link inline-flex items-center gap-1" type="button" onClick={() => setEditing({ ...user, isActive: isActive(user) })}><PencilLine size={13} /> Edit</button>
            </div>
          ))}
        </div>
      </section>
      {shown.length === 0 ? <div className="empty-state"><CircleUserRound className="mx-auto" /><h2>No users found</h2><p>Try another role filter.</p></div> : null}
      {editing ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[#21172b]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
          <form onSubmit={save} className={`${panelClass} w-full max-w-lg p-6`}>
            <div className="mb-5 flex items-start justify-between"><div><span className="section-kicker">Profile</span><h3 id="edit-user-title" className="mt-1 font-serif text-2xl">Edit user</h3></div><button type="button" aria-label="Close" onClick={() => setEditing(null)}><X size={20} /></button></div>
            <div className="grid gap-4">
              <Field label="Full name"><input className={inputClass} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required /></Field>
              <Field label="Email address"><input className={inputClass} type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} required /></Field>
              <Field label="Role"><input className={inputClass} value={editing.role} disabled /></Field>
              <div className="flex items-center justify-between rounded-xl border border-[#ded8d0] p-4 text-xs font-bold"><span><strong>Account active</strong><small className="mt-1 block font-normal text-[#726c73]">Inactive identities cannot sign in or call protected APIs.</small></span><input type="checkbox" aria-label="Account active" className="size-4 accent-[#de695c]" checked={isActive(editing)} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /></div>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={() => setEditing(null)} disabled={Boolean(busy)}>Cancel</button><button className="primary-button" disabled={Boolean(busy)}>{busy === `user-${editing.id}` ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} {busy === `user-${editing.id}` ? "Saving…" : "Save user"}</button></div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Classes({ data, busy, mutate }: { data: DashboardData; busy: string; mutate: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState<TeachingClass | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [leadId, setLeadId] = useState("");
  const [draft, setDraft] = useState({ name: "", code: "", term: "", status: "active" as "active" | "archived" });
  function open(item: TeachingClass) {
    setEditing(item);
    setSelected(memberships(item).map(memberId));
    setLeadId(memberId(memberships(item).find(memberLead) ?? {}));
  }
  async function saveClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const method = editing ? "PATCH" : "POST";
    const id = editing?.id;
    const ok = await mutate(`class-${id ?? "new"}`, () => api("/api/admin/classes", { method, body: JSON.stringify({ ...(id ? { classId: id } : {}), ...draft }) }), editing ? "Class details updated." : "Class created.");
    if (ok) { setCreating(false); setEditing(null); setDraft({ name: "", code: "", term: "", status: "active" }); }
  }
  async function saveMembers() {
    if (!editing) return;
    const memberPayload = selected.map((userId) => ({ userId, isLead: userId === leadId }));
    const ok = await mutate(`members-${editing.id}`, () => api(`/api/admin/classes/${editing.id}/members`, { method: "PUT", body: JSON.stringify({ members: memberPayload, userIds: selected, leadProfessorId: leadId || null }) }), "Class membership updated.");
    if (ok) setEditing(null);
  }
  const dialogOpen = creating || Boolean(editing);
  return (
    <div className="grid gap-5">
      <div className="flex justify-end"><button className="primary-button" type="button" onClick={() => { setCreating(true); setEditing(null); setDraft({ name: "", code: "", term: "", status: "active" }); }}><Plus size={16} /> Create class</button></div>
      <section className="grid gap-4 xl:grid-cols-2">
        {data.classes.map((item) => {
          const memberList = memberships(item);
          const studentCount = item.studentCount ?? memberList.filter((entry) => (entry.role ?? entry.user?.role) === "student").length;
          const professorCount = item.professorCount ?? memberList.filter((entry) => (entry.role ?? entry.user?.role) === "professor").length;
          return <article key={item.id} className={`${panelClass} p-6`}>
            <div className="flex items-start justify-between gap-4"><div><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[#de695c]">{item.code}</span><h3 className="mt-2 font-serif text-2xl">{item.name}</h3><p className="mt-1 text-xs text-[#726c73]">{item.term ?? item.semester ?? "Term not set"}</p></div><span className="status-badge">{item.status ?? "active"}</span></div>
            <div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f6f3ed] p-4"><UsersRound size={16} className="text-[#7f9d8f]" /><strong className="mt-2 block font-serif text-2xl">{studentCount}</strong><small className="text-[10px] uppercase tracking-[.1em] text-[#726c73]">Students</small></div><div className="rounded-xl bg-[#f6f3ed] p-4"><GraduationCap size={16} className="text-[#de695c]" /><strong className="mt-2 block font-serif text-2xl">{professorCount}</strong><small className="text-[10px] uppercase tracking-[.1em] text-[#726c73]">Professors</small></div></div>
            <div className="mt-5 flex justify-end"><button type="button" className="secondary-button" onClick={() => { open(item); setDraft({ name: item.name, code: item.code, term: item.term ?? item.semester ?? "", status: item.status ?? "active" }); }}><UserCog size={15} /> Manage class</button></div>
          </article>;
        })}
      </section>
      {data.classes.length === 0 ? <div className="empty-state"><School className="mx-auto" /><h2>No classes yet</h2><p>Create a cohort before assigning teaching cases.</p></div> : null}
      {dialogOpen ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#21172b]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="class-dialog-title">
          <div className={`${panelClass} mx-auto my-8 w-full max-w-3xl p-6`}>
            <div className="mb-5 flex items-start justify-between"><div><span className="section-kicker">Cohort</span><h3 id="class-dialog-title" className="mt-1 font-serif text-2xl">{creating ? "Create class" : "Manage class"}</h3></div><button type="button" aria-label="Close" onClick={() => { setCreating(false); setEditing(null); }}><X size={20} /></button></div>
            <form onSubmit={saveClass} className="grid gap-4 sm:grid-cols-2">
              <Field label="Class name"><input className={inputClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></Field>
              <Field label="Class code"><input className={inputClass} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })} required /></Field>
              <Field label="Term / semester"><input className={inputClass} value={draft.term} onChange={(event) => setDraft({ ...draft, term: event.target.value })} required /></Field>
              <Field label="Status"><select className={inputClass} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as "active" | "archived" })}><option value="active">Active</option><option value="archived">Archived</option></select></Field>
              <div className="sm:col-span-2 flex justify-end"><button className="secondary-button" disabled={Boolean(busy)}>{busy === `class-${editing?.id ?? "new"}` ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} {busy === `class-${editing?.id ?? "new"}` ? "Saving…" : creating ? "Create class" : "Save details"}</button></div>
            </form>
            {editing ? <>
              <div className="my-6 border-t border-[#ded8d0]" />
              <div><h4 className="font-serif text-xl">Members</h4><p className="mt-1 text-xs text-[#726c73]">Select students and professors. One selected professor may be the class lead.</p></div>
              <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-[#ded8d0]">
                {data.users.filter((user) => user.role !== "admin" && isActive(user)).map((user) => {
                  const checked = selected.includes(user.id);
                  return <div key={user.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-[#ded8d0] p-3 first:border-t-0"><input type="checkbox" className="size-4 accent-[#de695c]" checked={checked} onChange={(event) => setSelected(event.target.checked ? [...selected, user.id] : selected.filter((id) => id !== user.id))} /><span className="text-xs"><strong>{user.name}</strong><small className="ml-2 capitalize text-[#726c73]">{user.role}</small></span>{user.role === "professor" && checked ? <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.08em] text-[#726c73]"><input type="radio" name="lead" checked={leadId === user.id} onChange={() => setLeadId(user.id)} /> Lead</label> : null}</div>;
                })}
              </div>
              <div className="mt-6 flex justify-end"><button type="button" className="primary-button" onClick={() => void saveMembers()} disabled={Boolean(busy)}>{busy === `members-${editing.id}` ? <LoaderCircle size={15} className="spin" /> : <UsersRound size={15} />} {busy === `members-${editing.id}` ? "Saving…" : "Save members"}</button></div>
            </> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Cases({ data, busy, mutate, setError }: { data: DashboardData; busy: string; mutate: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean>; setError: (message: string) => void }) {
  const [editor, setEditor] = useState<CaseVersion | null>(null);
  const [expandedPhase, setExpandedPhase] = useState(0);
  const [moveOpenAssignments, setMoveOpenAssignments] = useState<Record<string, boolean>>({});
  function startNew() {
    setExpandedPhase(0);
    setEditor({
      id: "",
      title: "",
      description: "",
      difficulty: "intermediate",
      status: "draft",
      version: 1,
      learningObjectives: [""],
      phases: DEFAULT_PHASES.map(clonePhase),
      attachments: [],
      findings: [],
    });
  }
  function edit(item: CaseVersion) {
    setExpandedPhase(0);
    const draft = cloneCaseDraft(item);
    setEditor({
      ...draft,
      learningObjectives: draft.learningObjectives?.length ? draft.learningObjectives : [""],
      phases: draft.phases?.length ? draft.phases : DEFAULT_PHASES.map(clonePhase),
      attachments: draft.attachments ?? [],
      findings: draft.findings ?? [],
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    const editorDiagnostics = editor.id ? diagnosticsForDraft(data.diagnostics, editor.id) : [];
    if (editorDiagnostics.length) {
      setError("Resolve the flagged stored media rows (or remove them) before saving this case.");
      return;
    }
    const payload = serializeCaseDraft(editor);
    const ok = await mutate(`case-${editor.id || "new"}`, () => api("/api/admin/cases", { method: editor.id ? "PATCH" : "POST", body: JSON.stringify(editor.id ? { caseId: editor.id, ...payload } : payload) }), editor.id ? "Case draft saved." : "Case draft created.");
    if (ok) setEditor(null);
  }
  function updatePhase(index: number, patch: Partial<CasePhaseDraft>) { if (!editor?.phases) return; setEditor({ ...editor, phases: editor.phases.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...patch } : phase) }); }
  function updateRubric(phaseIndex: number, criterionIndex: number, patch: Partial<RubricCriterionDraft>) {
    if (!editor?.phases) return;
    const phases = editor.phases.map((phase, index) => {
      if (index !== phaseIndex) return phase;
      const rubric = phase.rubric.map((criterion, itemIndex) => {
        if (itemIndex !== criterionIndex) return criterion;
        return typeof criterion === "string" ? patch.text ?? criterion : { ...criterion, ...patch };
      });
      return { ...phase, rubric };
    });
    setEditor({ ...editor, phases });
  }
  function addRubric(phaseIndex: number) {
    if (!editor?.phases) return;
    setEditor({ ...editor, phases: editor.phases.map((phase, index) => index === phaseIndex ? { ...phase, rubric: [...phase.rubric, ""] } : phase) });
  }
  function removeRubric(phaseIndex: number, criterionIndex: number) {
    if (!editor?.phases) return;
    setEditor({ ...editor, phases: editor.phases.map((phase, index) => index === phaseIndex && phase.rubric.length > 1 ? { ...phase, rubric: phase.rubric.filter((_, itemIndex) => itemIndex !== criterionIndex) } : phase) });
  }
  function updateTutorMove(phaseIndex: number, moveIndex: number, patch: Partial<NonNullable<CasePhaseDraft["tutorMoves"]>[number]>) {
    if (!editor?.phases) return;
    setEditor({ ...editor, phases: editor.phases.map((phase, index) => index === phaseIndex ? { ...phase, tutorMoves: (phase.tutorMoves ?? []).map((move, itemIndex) => itemIndex === moveIndex ? { ...move, ...patch } : move) } : phase) });
  }
  function addPhase() {
    if (!editor?.phases || editor.phases.length >= MAX_PHASES) return;
    const nextIndex = editor.phases.length;
    setEditor({ ...editor, phases: [...editor.phases.map(clonePhase), blankPhase(nextIndex)] });
    setExpandedPhase(nextIndex);
  }
  function removePhase(index: number) {
    if (!editor?.phases || editor.phases.length <= 1) return;
    const phases = editor.phases.filter((_, phaseIndex) => phaseIndex !== index).map(clonePhase);
    setEditor({ ...editor, phases });
    setExpandedPhase((current) => current === index ? Math.min(index, phases.length - 1) : current > index ? current - 1 : current);
  }
  function addAttachment() {
    if (!editor) return;
    setEditor({
      ...editor,
      attachments: [...(editor.attachments ?? []), { id: crypto.randomUUID(), kind: "image", title: "", description: "", url: "", posterUrl: "", transcript: "", sourceLabel: "", sourceUrl: "", unlockPhase: 1, unlockOnRequest: false }],
    });
  }
  function updateAttachment(index: number, patch: Partial<CaseAttachmentDraft>) {
    if (!editor) return;
    const attachments = (editor.attachments ?? []).map((attachment, attachmentIndex) => attachmentIndex === index ? { ...attachment, ...patch } : attachment);
    setEditor({ ...editor, attachments });
  }
  function removeAttachment(index: number) {
    if (!editor) return;
    setEditor({ ...editor, attachments: (editor.attachments ?? []).filter((_, attachmentIndex) => attachmentIndex !== index) });
  }
  function addFinding() {
    if (!editor) return;
    setEditor({ ...editor, findings: [...(editor.findings ?? []), { id: crypto.randomUUID(), title: "", text: "", unlockPhase: 1, unlockOnRequest: false }] });
  }
  function updateFinding(index: number, patch: Partial<CaseFindingDraft>) {
    if (!editor) return;
    setEditor({ ...editor, findings: (editor.findings ?? []).map((finding, findingIndex) => findingIndex === index ? { ...finding, ...patch } : finding) });
  }
  function removeFinding(index: number) {
    if (!editor) return;
    setEditor({ ...editor, findings: (editor.findings ?? []).filter((_, findingIndex) => findingIndex !== index) });
  }
  const editorDiagnostics = editor?.id ? diagnosticsForDraft(data.diagnostics, editor.id) : [];
  return (
    <div className="grid gap-5">
      <div className="flex justify-end"><button type="button" className="primary-button" onClick={startNew}><Plus size={16} /> New case draft</button></div>
      <section className="grid gap-4">
        {data.cases.map((item) => {
          const { canEdit, canPublish, canClone, canArchive } = caseActionPolicy(item.status);
          const attachmentDiagnostics = diagnosticsForCase(data.diagnostics, item.id);
          const invalidStoredAttachments = attachmentDiagnostics.length > 0;
          return <article key={item.id} className={`${panelClass} grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:items-center`}>
            <div><div className="flex flex-wrap items-center gap-2"><span className="status-badge">{item.status}</span><span className="font-mono text-[10px] text-[#726c73]">VERSION {item.version ?? 1}</span></div><h3 className="mt-3 font-serif text-2xl">{item.title}</h3><p className="mt-2 max-w-3xl text-xs leading-5 text-[#726c73]">{item.description}</p><small className="mt-3 block text-[10px] uppercase tracking-[.1em] text-[#726c73]">{item.phases?.length ?? 0} phases · {item.learningObjectives?.length ?? 0} learning objectives · {item.attachments?.length ?? 0} media</small>{invalidStoredAttachments ? <div className="mt-4 rounded-lg border border-[#e2a39a] bg-[#fdf0ed] p-3 text-xs text-[#844335]" role="alert"><strong>Media diagnostics</strong><ul className="mt-1 grid gap-1">{attachmentDiagnostics.map((diagnostic) => <li key={`${diagnostic.index}-${diagnostic.attachmentId ?? "missing"}`}>Media {diagnostic.index + 1}: {diagnostic.reasons.join("; ")}</li>)}</ul><span className="mt-2 block text-[10px]">This case is locked for safe repair. Existing stored data is retained; use a reviewed migration or create a new draft from the source case.</span></div> : null}</div>
            <div className="flex flex-wrap gap-2">
              {canPublish && canEdit ? <><button type="button" className="secondary-button" onClick={() => edit(item)} disabled={Boolean(busy)}><PencilLine size={14} /> Edit</button><label className="flex items-center gap-2 rounded-lg border border-[#ded8d0] px-3 py-2 text-[10px] font-bold text-[#4e263f]" title="Open assignments can move to the newly published version; existing sessions stay on their original version."><input type="checkbox" className="size-4 accent-[#de695c]" checked={moveOpenAssignments[item.id] ?? true} onChange={(event) => setMoveOpenAssignments((current) => ({ ...current, [item.id]: event.target.checked }))} /><span>Move open assignments<small className="block font-normal text-[#726c73]">Existing sessions stay original</small></span></label><button type="button" className="primary-button" disabled={Boolean(busy) || invalidStoredAttachments} title={invalidStoredAttachments ? "Case locked: reviewed repair required" : undefined} onClick={() => void mutate(`publish-${item.id}`, () => api(`/api/admin/cases/${item.id}/publish`, { method: "POST", body: JSON.stringify({ moveOpenAssignments: moveOpenAssignments[item.id] ?? true }) }), "Case published and locked as an immutable version.")}>{busy === `publish-${item.id}` ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />} {busy === `publish-${item.id}` ? "Publishing…" : "Publish"}</button></> : null}
              {canClone ? <button type="button" className="secondary-button" disabled={Boolean(busy) || invalidStoredAttachments} title={invalidStoredAttachments ? "Case locked: reviewed repair required" : undefined} onClick={() => void mutate(`clone-${item.id}`, () => api(`/api/admin/cases/${item.id}/clone`, { method: "POST" }), "A new editable case version was created.")}>{busy === `clone-${item.id}` ? <LoaderCircle size={14} className="spin" /> : <Copy size={14} />} {busy === `clone-${item.id}` ? "Creating…" : "New version"}</button> : null}
              {canArchive ? <button type="button" title={busy === `archive-${item.id}` ? "Archiving" : "Archive"} aria-label={busy === `archive-${item.id}` ? `Archiving ${item.title}` : `Archive ${item.title}`} className="rounded-lg border border-[#ded8d0] p-3 text-[#726c73] hover:text-[#be5048] disabled:cursor-wait disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void mutate(`archive-${item.id}`, () => api("/api/admin/cases", { method: "PATCH", body: JSON.stringify({ caseId: item.id, status: "archived" }) }), "Case archived.")}>{busy === `archive-${item.id}` ? <LoaderCircle size={15} className="spin" /> : <Archive size={15} />}</button> : null}
            </div>
          </article>;
        })}
      </section>
      {data.cases.length === 0 ? <div className="empty-state"><BookOpen className="mx-auto" /><h2>No cases yet</h2><p>Create a draft with one or more teaching phases to begin.</p></div> : null}
      {editor ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#21172b]/50 p-3 md:p-6" role="dialog" aria-modal="true" aria-labelledby="case-editor-title">
          <form onSubmit={save} className={`${panelClass} mx-auto my-4 w-full max-w-5xl p-5 md:p-8`}>
            <div className="mb-6 flex items-start justify-between"><div><span className="section-kicker">Case authoring</span><h3 id="case-editor-title" className="mt-1 font-serif text-3xl">{editor.id ? "Edit case draft" : "New case draft"}</h3></div><button type="button" aria-label="Close" onClick={() => setEditor(null)}><X size={22} /></button></div>
            {editorDiagnostics.length ? <div className="error-banner mb-5" role="alert"><strong>Stored media needs a reviewed repair before this case can be saved.</strong><ul className="mt-2 grid gap-1">{editorDiagnostics.map((diagnostic) => <li key={`${diagnostic.index}-${diagnostic.attachmentId ?? "missing"}`}>Media {diagnostic.index + 1}: {diagnostic.reasons.join("; ")}</li>)}</ul><span className="mt-2 block text-xs">This editor will not rewrite malformed stored rows. Existing data is retained; use a reviewed migration or create a new draft from the source case.</span></div> : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Case title"><input className={inputClass} maxLength={CASE_TITLE_MAX_LENGTH} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} required /></Field>
              <Field label="Difficulty"><select className={inputClass} value={editor.difficulty} onChange={(event) => setEditor({ ...editor, difficulty: event.target.value as CaseVersion["difficulty"] })}><option value="foundation">Foundation</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></Field>
              <div className="md:col-span-2"><Field label="Case description"><textarea className={`${inputClass} min-h-24 resize-y`} maxLength={CASE_DESCRIPTION_MAX_LENGTH} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} required /></Field></div>
              <div className="md:col-span-2"><Field label="Learning objectives" hint="Enter one objective per line."><textarea className={`${inputClass} min-h-24 resize-y`} value={editor.learningObjectives?.join("\n") ?? ""} onChange={(event) => setEditor({ ...editor, learningObjectives: event.target.value.split("\n") })} required /></Field></div>
              <Field label="Correction probes" hint="How many evidence probes precede an explicit correction."><select className={inputClass} value={editor.correctionProbes ?? ""} onChange={(event) => setEditor({ ...editor, correctionProbes: event.target.value ? Number(event.target.value) as 1 | 2 : undefined })}><option value="">Default</option><option value="1">One probe</option><option value="2">Two probes</option></select></Field>
            </div>
            <div className="my-7 border-t border-[#ded8d0]" />
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-serif text-2xl">Teaching media</h4><p className="mt-1 text-xs text-[#726c73]">Attach up to 12 synthetic or published teaching assets. External HTTPS media requires both a source label and source URL.</p></div><button type="button" className="secondary-button" onClick={addAttachment} disabled={(editor.attachments?.length ?? 0) >= 12}><Plus size={15} /> Add media</button></div>
            <div className="mt-5 grid gap-3">
              {editor.attachments?.map((attachment, index) => (
                <section key={attachment.id} className="rounded-xl border border-[#ded8d0] p-4">
                  <div className="mb-4 flex items-center justify-between"><strong className="font-serif">Media {index + 1}</strong><button type="button" className="rounded-lg p-2 text-[#726c73] hover:bg-[#ece7de] hover:text-[#be5048]" onClick={() => removeAttachment(index)} aria-label={`Remove ${attachment.title || `media ${index + 1}`}`}><X size={16} /></button></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Type"><select className={inputClass} value={attachment.kind} onChange={(event) => updateAttachment(index, { kind: event.target.value as CaseAttachmentDraft["kind"] })}><option value="image">Image / OPG</option><option value="video">Video</option><option value="audio">Audio</option></select></Field>
                    <Field label="Title"><input className={inputClass} value={attachment.title} onChange={(event) => updateAttachment(index, { title: event.target.value })} required /></Field>
                    <div className="md:col-span-2"><Field label="Accessible description" hint="Describe the image or teaching content without disclosing the intended diagnosis."><textarea className={`${inputClass} min-h-20 resize-y`} value={attachment.description} onChange={(event) => updateAttachment(index, { description: event.target.value })} required /></Field></div>
                    <Field label="Media URL" hint="Leave blank when using a private storage path."><input className={inputClass} maxLength={MEDIA_URL_MAX_LENGTH} type="text" inputMode="url" placeholder="/media/case-opg.jpg or https://…" value={attachment.url ?? ""} onChange={(event) => updateAttachment(index, { url: event.target.value })} required={attachment.kind !== "audio" || !attachment.transcript} /></Field>
                    {attachment.kind === "video" ? <Field label="Poster URL"><input className={inputClass} maxLength={MEDIA_URL_MAX_LENGTH} type="text" inputMode="url" value={attachment.posterUrl ?? ""} onChange={(event) => updateAttachment(index, { posterUrl: event.target.value })} /></Field> : null}
                    <Field label="Source / citation"><input className={inputClass} placeholder="Journal, author, figure…" value={attachment.sourceLabel ?? ""} onChange={(event) => updateAttachment(index, { sourceLabel: event.target.value })} /></Field>
                    <Field label="Source URL"><input className={inputClass} maxLength={MEDIA_URL_MAX_LENGTH} type="url" placeholder="https://…" value={attachment.sourceUrl ?? ""} onChange={(event) => updateAttachment(index, { sourceUrl: event.target.value })} /></Field>
                    <Field label="Private storage path" hint="Safe object key only; do not combine with a public media URL."><input className={inputClass} maxLength={512} placeholder="cases/<case-id>/<attachment-id>.webp" value={attachment.storagePath ?? ""} onChange={(event) => updateAttachment(index, { storagePath: event.target.value })} /></Field>
                    <Field label="Unlock phase"><input className={inputClass} type="number" min={1} max={editor.phases?.length ?? MAX_PHASES} value={attachment.unlockPhase ?? 1} onChange={(event) => updateAttachment(index, { unlockPhase: Number(event.target.value) || 1 })} /></Field>
                    <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-[#4e263f]"><input type="checkbox" className="size-4 accent-[#de695c]" checked disabled aria-label="Phase unlock only" /> Phase unlock only <span className="font-normal text-[#726c73]">(request unlocking is unavailable)</span></label>
                    {attachment.kind === "audio" ? <div className="md:col-span-2"><Field label="Transcript" hint="Required when no audio URL is supplied."><textarea className={`${inputClass} min-h-24 resize-y`} value={attachment.transcript ?? ""} onChange={(event) => updateAttachment(index, { transcript: event.target.value })} required={!attachment.url} /></Field></div> : null}
                  </div>
                </section>
              ))}
              {editor.attachments?.length === 0 ? <p className="rounded-xl border border-dashed border-[#ded8d0] p-4 text-xs text-[#726c73]">No media attached. The student view will state that this case has no case-specific teaching media.</p> : null}
            </div>
            <div className="my-7 border-t border-[#ded8d0]" />
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-serif text-2xl">Case findings</h4><p className="mt-1 text-xs text-[#726c73]">Optional staged findings revealed by phase. Enter only evidence intended for this synthetic teaching case.</p></div><button type="button" className="secondary-button" onClick={addFinding} disabled={(editor.findings?.length ?? 0) >= 40}><Plus size={15} /> Add finding</button></div>
            <div className="mt-5 grid gap-3">
              {editor.findings?.map((finding, index) => <section key={finding.id || index} className="rounded-xl border border-[#ded8d0] p-4"><div className="mb-4 flex items-center justify-between"><strong className="font-serif">Finding {index + 1}</strong><button type="button" className="rounded-lg p-2 text-[#726c73] hover:bg-[#ece7de] hover:text-[#be5048]" onClick={() => removeFinding(index)} aria-label={`Remove finding ${index + 1}`}><X size={16} /></button></div><div className="grid gap-4 md:grid-cols-2"><Field label="Finding ID"><input className={inputClass} maxLength={100} value={finding.id} onChange={(event) => updateFinding(index, { id: event.target.value })} required /></Field><Field label="Title"><input className={inputClass} maxLength={160} value={finding.title} onChange={(event) => updateFinding(index, { title: event.target.value })} required /></Field><div className="md:col-span-2"><Field label="Finding text"><textarea className={`${inputClass} min-h-20 resize-y`} maxLength={1500} value={finding.text} onChange={(event) => updateFinding(index, { text: event.target.value })} required /></Field></div><Field label="Unlock phase"><input className={inputClass} type="number" min={1} max={editor.phases?.length ?? MAX_PHASES} value={finding.unlockPhase} onChange={(event) => updateFinding(index, { unlockPhase: Number(event.target.value) || 1 })} /></Field><label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-[#4e263f]"><input type="checkbox" className="size-4 accent-[#de695c]" checked disabled aria-label="Phase unlock only" /> Phase unlock only <span className="font-normal text-[#726c73]">(request unlocking is unavailable)</span></label></div></section>)}
              {editor.findings?.length === 0 ? <p className="rounded-xl border border-dashed border-[#ded8d0] p-4 text-xs text-[#726c73]">No staged findings configured.</p> : null}
            </div>
            <div className="my-7 border-t border-[#ded8d0]" />
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="font-serif text-2xl">Teaching phases</h4><p className="mt-1 text-xs text-[#726c73]">Add between 1 and {MAX_PHASES} phases. Each phase needs a goal, rubric, opening question and follow-up question bank.</p></div><button type="button" className="secondary-button" onClick={addPhase} disabled={Boolean(busy) || (editor.phases?.length ?? 0) >= MAX_PHASES}><Plus size={15} /> Add phase</button></div>
            <div className="mt-5 grid gap-3">
              {editor.phases?.map((phase, index) => {
                const expanded = expandedPhase === index;
                return <section key={phase.id ?? index} className="overflow-hidden rounded-xl border border-[#ded8d0]">
                  <div className="flex items-center gap-2 bg-[#f6f3ed] px-4 py-3">
                    <button type="button" className="flex min-w-0 flex-1 items-center justify-between text-left" onClick={() => setExpandedPhase(expanded ? -1 : index)}><span><small className="mr-3 font-mono text-[#de695c]">{String(index + 1).padStart(2, "0")}</small><strong className="font-serif">{phase.title || `Phase ${index + 1}`}</strong></span>{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>
                    <button type="button" className="rounded-lg border border-[#ded8d0] p-2 text-[#726c73] hover:text-[#be5048] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => removePhase(index)} disabled={Boolean(busy) || (editor.phases?.length ?? 0) <= 1} aria-label={`Remove phase ${index + 1}`} title={(editor.phases?.length ?? 0) <= 1 ? "At least one phase is required" : "Remove phase"}><Minus size={15} /></button>
                  </div>
                  {expanded ? <div className="grid gap-4 p-4 md:grid-cols-2">
                    <Field label="Phase title"><input className={inputClass} value={phase.title} onChange={(event) => updatePhase(index, { title: event.target.value })} required /></Field>
                    <Field label="Learning goal"><input className={inputClass} value={phase.goal} onChange={(event) => updatePhase(index, { goal: event.target.value })} required /></Field>
                     <div className="md:col-span-2"><Field label="Rubric criteria" hint="Legacy string criteria stay strings. Structured criteria retain ID and optional reveal text."><div className="grid gap-2">{phase.rubric.map((criterion, criterionIndex) => <div className="rounded-lg border border-[#ded8d0] p-3" key={`${phase.id ?? index}-criterion-${criterionIndex}`}><div className="flex gap-2"><input className={inputClass} maxLength={typeof criterion === "string" ? 180 : 500} value={typeof criterion === "string" ? criterion : criterion.text} onChange={(event) => updateRubric(index, criterionIndex, { text: event.target.value })} aria-label={`Criterion ${criterionIndex + 1} text`} required /><button type="button" className="rounded-lg border border-[#ded8d0] px-3 text-[#726c73] hover:text-[#be5048] disabled:opacity-40" onClick={() => removeRubric(index, criterionIndex)} disabled={phase.rubric.length <= 1} aria-label={`Remove criterion ${criterionIndex + 1}`}><X size={15} /></button></div>{typeof criterion !== "string" ? <div className="mt-2 grid gap-2 md:grid-cols-2"><input className={inputClass} maxLength={100} value={criterion.id} onChange={(event) => updateRubric(index, criterionIndex, { id: event.target.value })} aria-label={`Criterion ${criterionIndex + 1} ID`} placeholder="Criterion ID" required /><input className={inputClass} maxLength={500} value={criterion.revealText ?? ""} onChange={(event) => updateRubric(index, criterionIndex, { revealText: event.target.value || undefined })} aria-label={`Criterion ${criterionIndex + 1} reveal text`} placeholder="Optional reveal text" /></div> : null}</div>)}</div><button type="button" className="secondary-button mt-2" onClick={() => addRubric(index)}><Plus size={14} /> Add criterion</button></Field></div>
                     <Field label="No-progress limit" hint="Escalate after this many unproductive turns."><input className={inputClass} type="number" min={1} max={4} value={phase.noProgressLimit ?? ""} onChange={(event) => updatePhase(index, { noProgressLimit: event.target.value ? Number(event.target.value) : undefined })} /></Field>
                     <Field label="Phase ceiling" hint="Maximum turns before support completes the phase."><input className={inputClass} type="number" min={2} max={MAX_PHASES} value={phase.phaseCeiling ?? ""} onChange={(event) => updatePhase(index, { phaseCeiling: event.target.value ? Number(event.target.value) : undefined })} /></Field>
                     <div className="md:col-span-2"><Field label="Starter question"><textarea className={`${inputClass} min-h-20 resize-y`} value={phase.starterQuestion} onChange={(event) => updatePhase(index, { starterQuestion: event.target.value })} required /></Field></div>
                    <div className="md:col-span-2"><Field label="Follow-up question bank" hint="One question per line."><textarea className={`${inputClass} min-h-24 resize-y`} value={phase.exampleQuestions.join("\n")} onChange={(event) => updatePhase(index, { exampleQuestions: event.target.value.split("\n") })} required /></Field></div>
                    <div className="md:col-span-2"><Field label="Tutor guidance" hint="Optional phase-specific guidance; one instruction per line."><textarea className={`${inputClass} min-h-20 resize-y`} value={phase.tutorGuidance?.join("\n") ?? ""} onChange={(event) => updatePhase(index, { tutorGuidance: event.target.value.split("\n") })} /></Field></div>
                     <div className="md:col-span-2"><Field label="Scripted tutor moves" hint="Existing structured moves are preserved; target criterion IDs remain editable."><div className="grid gap-2">{phase.tutorMoves?.length ? phase.tutorMoves.map((move, moveIndex) => <div className="rounded-lg border border-[#ded8d0] bg-[#f6f3ed] p-3 text-xs text-[#726c73]" key={move.id}><strong className="mr-2 uppercase text-[#4e263f]">{move.strategy}</strong>{move.question}<input className={`${inputClass} mt-2`} maxLength={100} value={move.targetCriterionId ?? ""} onChange={(event) => updateTutorMove(index, moveIndex, { targetCriterionId: event.target.value || undefined })} aria-label={`Target criterion for scripted move ${moveIndex + 1}`} placeholder="Target criterion ID (optional)" /></div>) : <div className="rounded-lg border border-[#ded8d0] bg-[#f6f3ed] p-3 text-xs text-[#726c73]">No scripted moves configured.</div>}</div></Field></div>
                  </div> : null}
                </section>;
              })}
            </div>
            <div className="mt-7 flex flex-wrap justify-end gap-2"><button type="button" className="secondary-button" onClick={() => setEditor(null)} disabled={Boolean(busy)}>Cancel</button><button className="primary-button" disabled={Boolean(busy) || editorDiagnostics.length > 0} title={editorDiagnostics.length ? "Case locked: reviewed repair required" : undefined}>{busy === `case-${editor.id || "new"}` ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} {busy === `case-${editor.id || "new"}` ? "Saving…" : "Save draft"}</button></div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ActivityView({ data, busy, mutate }: { data: DashboardData; busy: string; mutate: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  const professors = data.users.filter((item) => item.role === "professor" && isActive(item));
  const [classFilter, setClassFilter] = useState("all");
  const [assignee, setAssignee] = useState<Record<string, string>>({});
  const shown = useMemo(() => data.sessions.filter((item) => {
    const classId = item.class?.id ?? item.teachingClass?.id ?? item.assignment?.class?.id;
    return classFilter === "all" || classId === classFilter;
  }), [classFilter, data.sessions]);
  const completed = shown.filter((item) => sessionValue(item).status === "completed").length;
  const reviewed = shown.filter((item) => reviewStatus(item) === "completed").length;
  async function reassign(item: AdminSession) {
    const session = sessionValue(item);
    await mutate(`reassign-${session.id}`, () => api("/api/admin/reviews/reassign", { method: "POST", body: JSON.stringify({ sessionId: session.id, professorId: assignee[session.id] || null }) }), assignee[session.id] ? "Review reassigned." : "Review claim released.");
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Field label="Class filter"><select className={`${inputClass} min-w-56`} value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="all">All classes</option>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <div className="flex gap-5 text-right text-xs"><div><strong className="block font-serif text-2xl">{completed}/{shown.length}</strong><span className="text-[#726c73]">Sessions complete</span></div><div><strong className="block font-serif text-2xl">{reviewed}/{shown.length}</strong><span className="text-[#726c73]">Reviews complete</span></div></div>
      </div>
      <section className={`${panelClass} overflow-x-auto`}>
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[1fr_1fr_1.2fr_.7fr_.8fr_1.5fr] gap-4 bg-[#ece7de] px-5 py-3 text-[9px] font-extrabold uppercase tracking-[.12em] text-[#726c73]"><span>Student</span><span>Class</span><span>Case</span><span>Score</span><span>Review</span><span>Ownership</span></div>
          {shown.map((item) => {
            const session = sessionValue(item);
            const status = reviewStatus(item);
            const currentReviewer = reviewerId(item);
            const locked = status === "completed";
            return <div key={session.id} className="grid min-h-20 grid-cols-[1fr_1fr_1.2fr_.7fr_.8fr_1.5fr] items-center gap-4 border-t border-[#ded8d0] px-5 py-3 text-xs">
              <div><strong className="font-serif text-sm">{item.student?.name ?? "Unknown student"}</strong><small className="block text-[10px] text-[#726c73]">{session.status}</small></div>
              <span>{item.class?.name ?? item.teachingClass?.name ?? item.assignment?.class?.name ?? item.className ?? "—"}</span>
              <span>{item.case?.title ?? "—"}</span>
              <strong>{session.score == null ? "—" : `${session.score}/100`}</strong>
              <span className="status-badge w-fit">{status.replaceAll("_", " ")}</span>
              {locked ? <span className="text-[#726c73]">{item.reviewClaim?.reviewerName ?? item.reviewer?.name ?? professors.find((entry) => entry.id === currentReviewer)?.name ?? "Completed"}</span> : <div className="flex gap-2"><select aria-label={`Reviewer for ${item.student?.name ?? session.id}`} className={`${inputClass} py-2 text-xs`} value={assignee[session.id] ?? currentReviewer} onChange={(event) => setAssignee({ ...assignee, [session.id]: event.target.value })} disabled={Boolean(busy)}><option value="">Release claim</option>{professors.map((professor) => <option key={professor.id} value={professor.id}>{professor.name}</option>)}</select><button type="button" aria-label={busy === `reassign-${session.id}` ? "Saving review assignment" : "Save review assignment"} className="rounded-lg bg-[#4e263f] p-2 text-white disabled:cursor-wait disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void reassign(item)}>{busy === `reassign-${session.id}` ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}</button></div>}
            </div>;
          })}
        </div>
      </section>
      {shown.length === 0 ? <div className="empty-state"><ClipboardCheck className="mx-auto" /><h2>No session activity</h2><p>Student sessions will appear here after a class assignment begins.</p></div> : null}
    </div>
  );
}
