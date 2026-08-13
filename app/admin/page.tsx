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
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type AdminTab = "overview" | "users" | "classes" | "cases" | "activity" | "feedback";
type Role = "student" | "professor" | "admin";
type CaseStatus = "draft" | "published" | "archived" | "available";

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

interface CasePhaseDraft {
  id?: string;
  order: number;
  title: string;
  goal: string;
  rubric: string[];
  starterQuestion: string;
  exampleQuestions: string[];
}

interface CaseVersion {
  id: string;
  title: string;
  description: string;
  difficulty?: "foundation" | "intermediate" | "advanced";
  status: CaseStatus;
  version?: number;
  learningObjectives?: string[];
  phases?: CasePhaseDraft[];
  publishedAt?: string | null;
  published_at?: string | null;
}

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
}

const EMPTY_DATA: DashboardData = { overview: {}, users: [], classes: [], cases: [], sessions: [] };
const TABS: Array<{ id: AdminTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: UserCog },
  { id: "classes", label: "Classes", icon: School },
  { id: "cases", label: "Cases", icon: BookOpen },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "feedback", label: "Feedback lab", icon: FlaskConical },
];

const DEFAULT_PHASES: CasePhaseDraft[] = Array.from({ length: 5 }, (_, index) => ({
  order: index + 1,
  title: `Phase ${index + 1}`,
  goal: "",
  rubric: [""],
  starterQuestion: "",
  exampleQuestions: [""],
}));

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
  return (
    <label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">
      <span>{label}</span>
      {children}
      {hint ? <small className="font-normal text-[#726c73]">{hint}</small> : null}
    </label>
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
    setData({
      overview: requests[0].status === "fulfilled"
        ? ((requests[0].value as { overview?: OverviewData }).overview ?? requests[0].value as OverviewData)
        : {},
      users: requests[1].status === "fulfilled" ? unwrapList(requests[1].value, ["users"]) : [],
      classes: requests[2].status === "fulfilled" ? unwrapList(requests[2].value, ["classes"]) : [],
      cases: requests[3].status === "fulfilled" ? unwrapList(requests[3].value, ["cases"]) : [],
      sessions: requests[4].status === "fulfilled" ? unwrapList(requests[4].value, ["sessions"]) : [],
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
        <aside className="border-b border-[#ded8d0] bg-[#21172b] px-5 py-5 text-white lg:min-h-[calc(100vh-76px)] lg:border-b-0 lg:border-r lg:py-9">
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
                className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ${tab === id ? "bg-white text-[#4e263f]" : "text-white/65 hover:bg-white/10 hover:text-white"}`}
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
            <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>

          {error ? <div className="error-banner mb-5 mt-0" role="alert">{error}</div> : null}
          {notice ? <div className="success-banner" role="status"><Check size={15} /> {notice}</div> : null}
          {loading ? <div className="empty-state"><LoaderCircle className="spin mx-auto" /><p>Loading administration data…</p></div> : null}
          {!loading && tab === "overview" ? <Overview data={data} setTab={setTab} /> : null}
          {!loading && tab === "users" ? <Users data={data} busy={busy} mutate={mutate} /> : null}
          {!loading && tab === "classes" ? <Classes data={data} busy={busy} mutate={mutate} /> : null}
          {!loading && tab === "cases" ? <Cases data={data} busy={busy} mutate={mutate} /> : null}
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
  const roleCounts = typeof data.overview.users === "object" ? data.overview.users : undefined;
  const cards = [
    { label: "Active users", value: counts.users, icon: UsersRound, note: roleCounts ? `${roleCounts.student ?? 0} students · ${roleCounts.professor ?? 0} faculty` : "Across all teaching roles" },
    { label: "Teaching classes", value: counts.classes, icon: School, note: "Active and archived cohorts" },
    { label: "Open assignments", value: counts.assignments, icon: BookOpen, note: "Available to enrolled students" },
    { label: "Learning sessions", value: counts.sessions, icon: GraduationCap, note: `${data.overview.completionRate ?? 0}% completion rate` },
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
            {[{ title: "Organise", text: "Create cohorts and appoint lead faculty.", tab: "classes" as const }, { title: "Publish", text: "Author and version five-phase cases.", tab: "cases" as const }, { title: "Calibrate", text: "Monitor sessions and review ownership.", tab: "activity" as const }].map((item, index) => (
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
    await mutate(`user-${editing.id}`, () => api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userId: editing.id, name: editing.name, email: editing.email, isActive: isActive(editing) }) }), "User profile updated.");
    setEditing(null);
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
            <div className="mt-6 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" disabled={busy === `user-${editing.id}`}><Save size={15} /> Save user</button></div>
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
              <div className="sm:col-span-2 flex justify-end"><button className="secondary-button" disabled={busy === `class-${editing?.id ?? "new"}`}><Save size={15} /> {creating ? "Create class" : "Save details"}</button></div>
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
              <div className="mt-6 flex justify-end"><button type="button" className="primary-button" onClick={() => void saveMembers()} disabled={busy === `members-${editing.id}`}><UsersRound size={15} /> Save members</button></div>
            </> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Cases({ data, busy, mutate }: { data: DashboardData; busy: string; mutate: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  const [editor, setEditor] = useState<CaseVersion | null>(null);
  const [expandedPhase, setExpandedPhase] = useState(0);
  function startNew() { setEditor({ id: "", title: "", description: "", difficulty: "intermediate", status: "draft", version: 1, learningObjectives: [""], phases: DEFAULT_PHASES.map((phase) => ({ ...phase, rubric: [...phase.rubric], exampleQuestions: [...phase.exampleQuestions] })) }); }
  function edit(item: CaseVersion) { setEditor({ ...item, learningObjectives: item.learningObjectives?.length ? [...item.learningObjectives] : [""], phases: item.phases?.length ? item.phases.map((phase) => ({ ...phase, rubric: [...phase.rubric], exampleQuestions: [...phase.exampleQuestions] })) : DEFAULT_PHASES.map((phase) => ({ ...phase, rubric: [...phase.rubric], exampleQuestions: [...phase.exampleQuestions] })) }); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    const payload = { ...editor, learningObjectives: editor.learningObjectives?.filter(Boolean), phases: editor.phases?.map((phase, index) => ({ ...phase, order: index + 1, rubric: phase.rubric.filter(Boolean), exampleQuestions: phase.exampleQuestions.filter(Boolean) })) };
    const ok = await mutate(`case-${editor.id || "new"}`, () => api("/api/admin/cases", { method: editor.id ? "PATCH" : "POST", body: JSON.stringify(editor.id ? { caseId: editor.id, ...payload } : payload) }), editor.id ? "Case draft saved." : "Case draft created.");
    if (ok) setEditor(null);
  }
  function updatePhase(index: number, patch: Partial<CasePhaseDraft>) { if (!editor?.phases) return; setEditor({ ...editor, phases: editor.phases.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...patch } : phase) }); }
  return (
    <div className="grid gap-5">
      <div className="flex justify-end"><button type="button" className="primary-button" onClick={startNew}><Plus size={16} /> New case draft</button></div>
      <section className="grid gap-4">
        {data.cases.map((item) => {
          const immutable = item.status === "published" || item.status === "available";
          return <article key={item.id} className={`${panelClass} grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:items-center`}>
            <div><div className="flex flex-wrap items-center gap-2"><span className="status-badge">{item.status}</span><span className="font-mono text-[10px] text-[#726c73]">VERSION {item.version ?? 1}</span></div><h3 className="mt-3 font-serif text-2xl">{item.title}</h3><p className="mt-2 max-w-3xl text-xs leading-5 text-[#726c73]">{item.description}</p><small className="mt-3 block text-[10px] uppercase tracking-[.1em] text-[#726c73]">{item.phases?.length ?? 0} phases · {item.learningObjectives?.length ?? 0} learning objectives</small></div>
            <div className="flex flex-wrap gap-2">
              {!immutable && item.status !== "archived" ? <><button type="button" className="secondary-button" onClick={() => edit(item)}><PencilLine size={14} /> Edit</button><button type="button" className="primary-button" disabled={busy === `publish-${item.id}`} onClick={() => void mutate(`publish-${item.id}`, () => api(`/api/admin/cases/${item.id}/publish`, { method: "POST" }), "Case published and locked as an immutable version.")}><Send size={14} /> Publish</button></> : null}
              {immutable ? <button type="button" className="secondary-button" disabled={busy === `clone-${item.id}`} onClick={() => void mutate(`clone-${item.id}`, () => api(`/api/admin/cases/${item.id}/clone`, { method: "POST" }), "A new editable case version was created.")}><Copy size={14} /> New version</button> : null}
              {item.status !== "archived" ? <button type="button" title="Archive" aria-label={`Archive ${item.title}`} className="rounded-lg border border-[#ded8d0] p-3 text-[#726c73] hover:text-[#be5048]" disabled={busy === `archive-${item.id}`} onClick={() => void mutate(`archive-${item.id}`, () => api("/api/admin/cases", { method: "PATCH", body: JSON.stringify({ caseId: item.id, status: "archived" }) }), "Case archived.")}><Archive size={15} /></button> : null}
            </div>
          </article>;
        })}
      </section>
      {data.cases.length === 0 ? <div className="empty-state"><BookOpen className="mx-auto" /><h2>No cases yet</h2><p>Create a five-phase draft to begin.</p></div> : null}
      {editor ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#21172b]/50 p-3 md:p-6" role="dialog" aria-modal="true" aria-labelledby="case-editor-title">
          <form onSubmit={save} className={`${panelClass} mx-auto my-4 w-full max-w-5xl p-5 md:p-8`}>
            <div className="mb-6 flex items-start justify-between"><div><span className="section-kicker">Case authoring</span><h3 id="case-editor-title" className="mt-1 font-serif text-3xl">{editor.id ? "Edit case draft" : "New case draft"}</h3></div><button type="button" aria-label="Close" onClick={() => setEditor(null)}><X size={22} /></button></div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Case title"><input className={inputClass} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} required /></Field>
              <Field label="Difficulty"><select className={inputClass} value={editor.difficulty} onChange={(event) => setEditor({ ...editor, difficulty: event.target.value as CaseVersion["difficulty"] })}><option value="foundation">Foundation</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></Field>
              <div className="md:col-span-2"><Field label="Case description"><textarea className={`${inputClass} min-h-24 resize-y`} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} required /></Field></div>
              <div className="md:col-span-2"><Field label="Learning objectives" hint="Enter one objective per line."><textarea className={`${inputClass} min-h-24 resize-y`} value={editor.learningObjectives?.join("\n") ?? ""} onChange={(event) => setEditor({ ...editor, learningObjectives: event.target.value.split("\n") })} required /></Field></div>
            </div>
            <div className="my-7 border-t border-[#ded8d0]" />
            <div><h4 className="font-serif text-2xl">Five teaching phases</h4><p className="mt-1 text-xs text-[#726c73]">Every phase needs a goal, rubric, opening question and follow-up question bank.</p></div>
            <div className="mt-5 grid gap-3">
              {editor.phases?.map((phase, index) => {
                const expanded = expandedPhase === index;
                return <section key={phase.id ?? index} className="overflow-hidden rounded-xl border border-[#ded8d0]">
                  <button type="button" className="flex w-full items-center justify-between bg-[#f6f3ed] px-4 py-3 text-left" onClick={() => setExpandedPhase(expanded ? -1 : index)}><span><small className="mr-3 font-mono text-[#de695c]">0{index + 1}</small><strong className="font-serif">{phase.title || `Phase ${index + 1}`}</strong></span>{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>
                  {expanded ? <div className="grid gap-4 p-4 md:grid-cols-2">
                    <Field label="Phase title"><input className={inputClass} value={phase.title} onChange={(event) => updatePhase(index, { title: event.target.value })} required /></Field>
                    <Field label="Learning goal"><input className={inputClass} value={phase.goal} onChange={(event) => updatePhase(index, { goal: event.target.value })} required /></Field>
                    <div className="md:col-span-2"><Field label="Rubric criteria" hint="One criterion per line."><textarea className={`${inputClass} min-h-20 resize-y`} value={phase.rubric.join("\n")} onChange={(event) => updatePhase(index, { rubric: event.target.value.split("\n") })} required /></Field></div>
                    <div className="md:col-span-2"><Field label="Starter question"><textarea className={`${inputClass} min-h-20 resize-y`} value={phase.starterQuestion} onChange={(event) => updatePhase(index, { starterQuestion: event.target.value })} required /></Field></div>
                    <div className="md:col-span-2"><Field label="Follow-up question bank" hint="One question per line."><textarea className={`${inputClass} min-h-24 resize-y`} value={phase.exampleQuestions.join("\n")} onChange={(event) => updatePhase(index, { exampleQuestions: event.target.value.split("\n") })} required /></Field></div>
                  </div> : null}
                </section>;
              })}
            </div>
            <div className="mt-7 flex flex-wrap justify-end gap-2"><button type="button" className="secondary-button" onClick={() => setEditor(null)}>Cancel</button><button className="primary-button" disabled={busy === `case-${editor.id || "new"}`}><Save size={15} /> Save draft</button></div>
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
              {locked ? <span className="text-[#726c73]">{item.reviewClaim?.reviewerName ?? item.reviewer?.name ?? professors.find((entry) => entry.id === currentReviewer)?.name ?? "Completed"}</span> : <div className="flex gap-2"><select aria-label={`Reviewer for ${item.student?.name ?? session.id}`} className={`${inputClass} py-2 text-xs`} value={assignee[session.id] ?? currentReviewer} onChange={(event) => setAssignee({ ...assignee, [session.id]: event.target.value })}><option value="">Release claim</option>{professors.map((professor) => <option key={professor.id} value={professor.id}>{professor.name}</option>)}</select><button type="button" aria-label="Save review assignment" className="rounded-lg bg-[#4e263f] p-2 text-white disabled:opacity-50" disabled={busy === `reassign-${session.id}`} onClick={() => void reassign(item)}>{busy === `reassign-${session.id}` ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}</button></div>}
            </div>;
          })}
        </div>
      </section>
      {shown.length === 0 ? <div className="empty-state"><ClipboardCheck className="mx-auto" /><h2>No session activity</h2><p>Student sessions will appear here after a class assignment begins.</p></div> : null}
    </div>
  );
}
