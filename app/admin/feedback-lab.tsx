"use client";

import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  Play,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExperimentMode,
  HumanizationOverview,
  ReleaseGateResult,
  TutorCandidate,
} from "@/lib/experiments/types";
import type { HumanizationMetrics } from "@/lib/tutor/humanization-metrics";

export interface FeedbackLabProps {
  /** Optional initial snapshot, useful when the parent has already loaded admin data. */
  initialData?: Partial<HumanizationOverview>;
  /** Optional wrapper class for host layouts. */
  className?: string;
}

type HumanizationAction = "run" | "experiment" | "approval" | "release" | "rollback";

interface CandidateDraft {
  name: string;
  provider: TutorCandidate["provider"];
  model: string;
  promptVersion: string;
  instructions: string;
}

const panelClass = "rounded-[3px_22px_3px_3px] border border-[#ded8d0] bg-[#fffdfa] shadow-[0_16px_45px_rgba(48,28,43,.06)]";
const inputClass = "w-full rounded-lg border border-[#ded8d0] bg-white px-3 py-2.5 text-sm text-[#21172b] outline-none transition focus:border-[#de695c] focus:ring-2 focus:ring-[#de695c]/15 disabled:bg-[#ece7de] disabled:text-[#726c73]";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50";

const EMPTY_DATA: HumanizationOverview = {
  datasets: [],
  candidates: [],
  runs: [],
  experiments: [],
  approvals: [],
  releases: [],
};

const EMPTY_DRAFT: CandidateDraft = {
  name: "",
  provider: "openai",
  model: "",
  promptVersion: "",
  instructions: "",
};

function asList<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const nested = (value as Record<string, unknown>)[key];
    if (Array.isArray(nested)) return nested as T[];
  }
  return [];
}

function readError(value: unknown, fallback: string) {
  if (value && typeof value === "object") {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
    const message = (value as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new Error(readError(body, `Request failed (${response.status}).`));
  return body as T;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function percent(value: number | null | undefined) {
  return value == null || Number.isNaN(value) ? "—" : `${Math.round(value * 100)}%`;
}

function score(value: number | null | undefined, digits = 2) {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

function metricsRows(baseline: HumanizationMetrics | null, candidate: HumanizationMetrics | null) {
  const keys: Array<{ key: keyof HumanizationMetrics; label: string; percent?: boolean }> = [
    { key: "exactAgreement", label: "Exact agreement", percent: true },
    { key: "balancedAccuracy", label: "Balanced accuracy", percent: true },
    { key: "meanAbsoluteError", label: "Mean absolute error" },
    { key: "signedBias", label: "Signed bias" },
    { key: "brierScore", label: "Brier score" },
    { key: "falseAdvanceRate", label: "False advance rate", percent: true },
    { key: "humanizationPassRate", label: "Structured tutor QA pass rate", percent: true },
  ];
  return keys.map(({ key, label, percent: isPercent }) => {
    const base = baseline?.[key] as number | null | undefined;
    const next = candidate?.[key] as number | null | undefined;
    const delta = base == null || next == null ? null : next - base;
    return { key, label, base: isPercent ? percent(base) : score(base), next: isPercent ? percent(next) : score(next), delta, isPercent };
  });
}

function gateTone(gate: ReleaseGateResult | null) {
  if (!gate) return "border-[#ded8d0] bg-[#f6f3ed] text-[#726c73]";
  return gate.passed ? "border-[#b8d4c0] bg-[#e5ede7] text-[#365846]" : "border-[#f0bcb5] bg-[#fae9e7] text-[#842f2b]";
}

export function FeedbackLab({ initialData, className = "" }: FeedbackLabProps) {
  const [data, setData] = useState<HumanizationOverview>({ ...EMPTY_DATA, ...initialData });
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<HumanizationAction | "load" | "">("");
  const [selectedDatasetId, setSelectedDatasetId] = useState(initialData?.datasets?.[0]?.id ?? "");
  const [selectedCandidateId, setSelectedCandidateId] = useState(initialData?.candidates?.[0]?.id ?? "");
  const [selectedRunId, setSelectedRunId] = useState(initialData?.runs?.[0]?.id ?? "");
  const [candidateDraft, setCandidateDraft] = useState<CandidateDraft>(EMPTY_DRAFT);
  const [experimentMode, setExperimentMode] = useState<ExperimentMode>("shadow");
  const [trafficPercent, setTrafficPercent] = useState(10);
  const [releaseNotes, setReleaseNotes] = useState("");
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [datasetName, setDatasetName] = useState(`Faculty frozen set ${new Date().toISOString().slice(0, 10)}`);

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    const endpoints: Array<[keyof HumanizationOverview, string]> = [
      ["datasets", "/api/admin/humanization/datasets"],
      ["candidates", "/api/admin/humanization/candidates"],
      ["runs", "/api/admin/humanization/runs"],
      ["experiments", "/api/admin/humanization/experiments"],
      ["releases", "/api/admin/humanization/releases"],
      ["approvals", "/api/admin/humanization/overview"],
    ];
    const results = await Promise.allSettled(endpoints.map(([, url]) => api<unknown>(url)));
    const updates: Partial<HumanizationOverview> = {};
    const failures: string[] = [];
    endpoints.forEach(([key], index) => {
      const result = results[index];
      if (result.status === "fulfilled") {
        const value = key === "approvals" && result.value && typeof result.value === "object"
          ? (result.value as HumanizationOverview).approvals
          : asList(result.value, key);
        Object.assign(updates, { [key]: value });
      } else {
        failures.push(result.reason instanceof Error ? result.reason.message : `${key} could not be loaded.`);
      }
    });
    setData((current) => ({ ...current, ...updates }));
    const nextDatasets = updates.datasets ?? [];
    const nextCandidates = updates.candidates ?? [];
    const nextRuns = updates.runs ?? [];
    setSelectedDatasetId((current) => current || nextDatasets[0]?.id || "");
    setSelectedCandidateId((current) => current || nextCandidates[0]?.id || "");
    setSelectedRunId((current) => current || nextRuns[0]?.id || "");
    if (failures.length) setError(failures.join(" "));
    setLoading(false);
    setBusy("");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedDataset = data.datasets.find((item) => item.id === selectedDatasetId) ?? null;
  const selectedCandidate = data.candidates.find((item) => item.id === selectedCandidateId) ?? null;
  const selectedRun = data.runs.find((item) => item.id === selectedRunId) ?? null;
  const selectedExperiment = data.experiments.find((item) => item.candidateId === selectedCandidateId && item.status !== "completed") ?? data.experiments.find((item) => item.candidateId === selectedCandidateId) ?? null;
  const selectedApproval = selectedRun ? data.approvals.find((item) => item.evalRunId === selectedRun.id) ?? null : null;
  const selectedRelease = selectedRun ? data.releases.find((item) => item.evalRunId === selectedRun.id && item.status === "active") ?? null : null;
  const rows = useMemo(() => metricsRows(selectedRun?.baselineMetrics ?? null, selectedRun?.candidateMetrics ?? null), [selectedRun]);

  const runCandidate = selectedRun ? data.candidates.find((item) => item.id === selectedRun.candidateId) ?? null : null;

  async function mutate(action: HumanizationAction, url: string, body: object, success: string, method: "POST" | "PATCH" = "POST") {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await api(url, { method, body: JSON.stringify(body) });
      setNotice(success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The change could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function createCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate("experiment", "/api/admin/humanization/candidates", { ...candidateDraft }, "Candidate saved. It is ready for offline evaluation.");
    setCandidateDraft(EMPTY_DRAFT);
    setShowCandidateForm(false);
  }

  async function freezeDataset() {
    await mutate("run", "/api/admin/humanization/datasets", { name: datasetName }, "De-identified faculty feedback was frozen into an immutable dataset.");
  }

  function runEvaluation() {
    if (!selectedDatasetId || !selectedCandidateId) return;
    void mutate("run", "/api/admin/humanization/runs", { datasetId: selectedDatasetId, candidateId: selectedCandidateId }, "Offline evaluation started. No online tutor state was changed.");
  }

  function startExperiment() {
    if (!selectedCandidateId || !selectedRunId) return;
    void mutate("experiment", "/api/admin/humanization/experiments", {
      evalRunId: selectedRunId,
      mode: experimentMode,
      trafficPercent: experimentMode === "shadow" ? 0 : trafficPercent,
      name: `${experimentMode === "shadow" ? "Shadow" : "A/B"} · ${runCandidate?.name ?? selectedCandidate?.name ?? "candidate"}`,
    }, `${experimentMode === "shadow" ? "Shadow" : "A/B"} experiment started.`);
  }

  function pauseExperiment(experimentId: string) {
    void mutate("experiment", "/api/admin/humanization/experiments", {
      action: "pause",
      experimentId,
    }, "Observation paused. Its immutable evidence remains available for the next governed stage.");
  }

  function releaseCandidate() {
    if (!selectedRun || !selectedCandidate || !selectedApproval || selectedApproval.decision !== "approved") return;
    void mutate("release", "/api/admin/humanization/releases", {
      evalRunId: selectedRun.id,
      trafficPercent,
      releaseNotes,
    }, "Candidate released with faculty approval.");
  }

  function rollbackRelease() {
    if (!selectedRelease) return;
    setBusy("rollback");
    setError("");
    setNotice("");
    void api("/api/admin/humanization/releases", {
      method: "PATCH",
      body: JSON.stringify({
        releaseId: selectedRelease.id,
        reason: releaseNotes || "Rolled back from the Admin feedback lab.",
      }),
    }).then(async () => {
      setNotice("Release rolled back. The previous approved candidate remains the fallback.");
      await load();
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "The release could not be rolled back.");
    }).finally(() => setBusy(""));
  }

  return (
    <section className={`grid gap-6 ${className}`} aria-labelledby="feedback-lab-title">
      <div className="rounded-[3px_22px_3px_3px] border border-[#b8d4c0] bg-[#e5ede7] p-5 text-[#365846]">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0" size={19} />
          <div>
            <strong id="feedback-lab-title" className="font-serif text-lg">Humanization feedback lab</strong>
            <p className="mt-1 text-xs leading-5">De-identified offline data only. There is no online self-training and no automatic rewrite of student learning state. Every release requires faculty approval.</p>
          </div>
        </div>
      </div>

      {error ? <div className="error-banner" role="alert"><AlertTriangle size={15} /> {error}</div> : null}
      {notice ? <div className="success-banner" role="status"><Check size={15} /> {notice}</div> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={LockKeyhole} label="Frozen datasets" value={data.datasets.filter((item) => item.status === "frozen").length} note="Versioned and de-identified" />
        <StatCard icon={GitBranch} label="Candidate runs" value={data.runs.length} note="Baseline vs candidate" />
        <StatCard icon={Sparkles} label="Active releases" value={data.releases.filter((item) => item.status === "active").length} note="Faculty-approved only" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.82fr)]">
        <div className="grid gap-6">
          <section className={`${panelClass} p-5 md:p-6`} aria-labelledby="dataset-heading">
            <SectionHeading eyebrow="01 / Evidence" title="Frozen evaluation data" icon={LockKeyhole} />
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[#726c73]">A frozen snapshot prevents feedback leakage. It is safe to compare prompt and model versions repeatedly without changing production sessions.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input aria-label="Frozen dataset name" className={inputClass} value={datasetName} onChange={(event) => setDatasetName(event.target.value)} /><button type="button" className={`${buttonClass} shrink-0 bg-[#4e263f] text-white`} disabled={busy === "run" || datasetName.trim().length < 3} onClick={() => void freezeDataset()}><LockKeyhole size={14} /> Freeze reviewed turns</button></div>
            {loading && !data.datasets.length ? <LoadingLine label="Loading datasets…" /> : null}
            {!loading && !data.datasets.length ? <EmptyLine label="No frozen datasets yet. Freeze an approved, de-identified faculty sample to begin." /> : null}
            <div className="mt-5 grid gap-3">
              {data.datasets.map((dataset) => (
                <button key={dataset.id} type="button" onClick={() => setSelectedDatasetId(dataset.id)} className={`grid gap-2 rounded-xl border p-4 text-left transition sm:grid-cols-[minmax(0,1fr)_auto] ${dataset.id === selectedDatasetId ? "border-[#4e263f] bg-[#f6f3ed]" : "border-[#ded8d0] bg-white hover:border-[#de695c]"}`}>
                  <span className="min-w-0"><strong className="block truncate font-serif text-base text-[#21172b]">{dataset.name}</strong><small className="mt-1 block text-[10px] text-[#726c73]">{dataset.entryCount} samples · hash {dataset.contentHash ? `${dataset.contentHash.slice(0, 10)}…` : "building"} · frozen {formatDate(dataset.frozenAt)}</small></span>
                  <span className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[.1em] text-[#476555]"><span className="rounded-full bg-[#e5ede7] px-2.5 py-1">{dataset.status}</span><ChevronRight size={14} /></span>
                </button>
              ))}
            </div>
            {selectedDataset ? <div className="mt-4 grid gap-2 border-t border-[#ded8d0] pt-4 text-[10px] text-[#726c73] sm:grid-cols-3"><span>De-identification: <strong className="text-[#21172b]">{selectedDataset.deidentificationVersion}</strong></span><span>Source window: <strong className="text-[#21172b]">{formatDate(selectedDataset.sourceFrom)} – {formatDate(selectedDataset.sourceTo)}</strong></span><span>Created: <strong className="text-[#21172b]">{formatDate(selectedDataset.createdAt)}</strong></span></div> : null}
          </section>

          <section className={`${panelClass} p-5 md:p-6`} aria-labelledby="candidate-heading">
            <div className="flex flex-wrap items-start justify-between gap-3"><SectionHeading eyebrow="02 / Candidates" title="Prompt and model versions" icon={GitBranch} /><button type="button" className={`${buttonClass} bg-[#ece7de] text-[#4e263f]`} onClick={() => setShowCandidateForm((value) => !value)}><Plus size={14} /> New candidate</button></div>
            {showCandidateForm ? <form className="mt-5 grid gap-3 rounded-xl border border-[#ded8d0] bg-[#f6f3ed] p-4" onSubmit={createCandidate}><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Name<input className={inputClass} required value={candidateDraft.name} onChange={(event) => setCandidateDraft({ ...candidateDraft, name: event.target.value })} placeholder="Human tutor v2" /></label><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Provider<select className={inputClass} value={candidateDraft.provider} onChange={(event) => setCandidateDraft({ ...candidateDraft, provider: event.target.value as TutorCandidate["provider"] })}><option value="openai">OpenAI</option><option value="claude">Claude</option><option value="deterministic">Deterministic</option></select></label><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Model<input className={inputClass} required value={candidateDraft.model} onChange={(event) => setCandidateDraft({ ...candidateDraft, model: event.target.value })} placeholder="gpt-5-mini" /></label><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Prompt version<input className={inputClass} required value={candidateDraft.promptVersion} onChange={(event) => setCandidateDraft({ ...candidateDraft, promptVersion: event.target.value })} placeholder="tutor-human-v2" /></label></div><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Instructions<textarea className={`${inputClass} min-h-20 resize-y`} minLength={100} required value={candidateDraft.instructions} onChange={(event) => setCandidateDraft({ ...candidateDraft, instructions: event.target.value })} placeholder="Describe the candidate's tutoring behavior and guardrails (at least 100 characters)." /></label><div className="flex justify-end gap-2"><button type="button" className={`${buttonClass} bg-white text-[#726c73]`} onClick={() => setShowCandidateForm(false)}>Cancel</button><button type="submit" className={`${buttonClass} bg-[#de695c] text-white`} disabled={busy === "experiment"}><Send size={14} /> Save candidate</button></div></form> : null}
            {loading && !data.candidates.length ? <LoadingLine label="Loading candidates…" /> : null}
            {!loading && !data.candidates.length ? <EmptyLine label="Create a candidate prompt/model version to compare against baseline." /> : null}
            <div className="mt-5 grid gap-3">
              {data.candidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => setSelectedCandidateId(candidate.id)} className={`grid gap-2 rounded-xl border p-4 text-left transition sm:grid-cols-[minmax(0,1fr)_auto] ${candidate.id === selectedCandidateId ? "border-[#4e263f] bg-[#f6f3ed]" : "border-[#ded8d0] bg-white hover:border-[#de695c]"}`}><span className="min-w-0"><strong className="block truncate font-serif text-base text-[#21172b]">{candidate.name}</strong><small className="mt-1 block truncate text-[10px] text-[#726c73]">{candidate.provider} · {candidate.model} · {candidate.promptVersion}</small></span><span className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[.1em] text-[#726c73]"><span className="rounded-full bg-[#ece7de] px-2.5 py-1">{candidate.status}</span><ChevronRight size={14} /></span></button>)}
            </div>
            {selectedCandidate ? <div className="mt-4 rounded-xl border border-[#ded8d0] bg-[#f6f3ed] p-4 text-xs leading-5 text-[#726c73]"><strong className="font-serif text-[#21172b]">Candidate instructions</strong><p className="mt-1 whitespace-pre-wrap">{selectedCandidate.instructions || "No additional instructions recorded."}</p></div> : null}
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section className={`${panelClass} p-5 md:p-6`} aria-labelledby="run-heading">
            <SectionHeading eyebrow="03 / Evaluate" title="Offline comparison" icon={BarChart3} />
            <p className="mt-2 text-xs leading-5 text-[#726c73]">Run candidate responses against the frozen set. This does not send new messages to students.</p>
            <div className="mt-5 grid gap-3"><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Dataset<select className={inputClass} value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}><option value="">Select a frozen dataset</option>{data.datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Candidate<select className={inputClass} value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)}><option value="">Select a candidate</option>{data.candidates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.promptVersion}</option>)}</select></label></div>
            <button type="button" className={`${buttonClass} mt-4 w-full bg-[#4e263f] text-white`} disabled={!selectedDatasetId || !selectedCandidateId || busy === "run"} onClick={runEvaluation}>{busy === "run" ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Run frozen-set evaluation</button>
            {data.runs.length ? <div className="mt-5 border-t border-[#ded8d0] pt-4"><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Evaluation run<select className={inputClass} value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>{data.runs.map((run) => <option key={run.id} value={run.id}>{run.status} · {formatDate(run.createdAt)}</option>)}</select></label></div> : null}
          </section>

          <section className={`${panelClass} overflow-hidden`} aria-labelledby="metrics-heading"><div className="border-b border-[#ded8d0] p-5 md:p-6"><SectionHeading eyebrow="04 / Gate" title="Baseline vs candidate" icon={BarChart3} /></div>{selectedRun ? <><div className="grid grid-cols-[minmax(0,1fr)_70px_70px_55px] gap-2 bg-[#ece7de] px-5 py-3 text-[9px] font-extrabold uppercase tracking-[.1em] text-[#726c73]"><span>Metric</span><span>Base</span><span>New</span><span>Δ</span></div><div className="divide-y divide-[#ded8d0]">{rows.map((row) => <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_70px_70px_55px] items-center gap-2 px-5 py-3 text-[10px]"><span className="leading-4 text-[#726c73]">{row.label}</span><strong>{row.base}</strong><strong>{row.next}</strong><span className={row.delta == null ? "text-[#726c73]" : row.delta >= 0 ? "text-[#476555]" : "text-[#842f2b]"}>{row.delta == null ? "—" : `${row.delta >= 0 ? "+" : ""}${row.isPercent ? `${Math.round(row.delta * 100)}pp` : row.delta.toFixed(2)}`}</span></div>)}</div><div className={`m-5 rounded-xl border p-4 text-xs ${gateTone(selectedRun.gate)}`}><div className="flex items-center justify-between gap-2"><strong className="font-serif">Release gate</strong><span className="font-extrabold uppercase tracking-[.1em]">{selectedRun.gate ? selectedRun.gate.passed ? "Passed" : "Blocked" : "Pending"}</span></div>{selectedRun.gate ? <><p className="mt-2 leading-5">{selectedRun.gate.sampleCount} samples · safety pass {percent(selectedRun.gate.safetyPassRate)}</p>{selectedRun.gate.reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px]"><li>{selectedRun.gate.reasons.join(" ")}</li></ul> : null}</> : <p className="mt-2 leading-5">Complete an offline run to calculate the release gate.</p>}</div></> : <EmptyLine label="Select an evaluation run to inspect metrics." />}</section>
        </aside>
      </div>

      <section className={`${panelClass} p-5 md:p-6`} aria-labelledby="experiment-heading"><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeading eyebrow="05 / Observe" title="Shadow and limited A/B" icon={FlaskConical} /><span className="rounded-full bg-[#f5e9e7] px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[.1em] text-[#be5048]">No auto-training</span></div><div className="mt-5 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end"><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Mode<select className={inputClass} value={experimentMode} onChange={(event) => setExperimentMode(event.target.value as ExperimentMode)}><option value="shadow">Shadow (0% student traffic)</option><option value="ab">A/B (limited traffic)</option></select></label><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Candidate<select className={inputClass} value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)}>{data.candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Traffic %<input className={inputClass} type="number" min={1} max={25} value={trafficPercent} disabled={experimentMode === "shadow"} onChange={(event) => setTrafficPercent(Math.min(25, Math.max(1, Number(event.target.value) || 1)))} /></label></div><div className="flex flex-wrap items-center gap-2">{selectedExperiment?.status === "running" ? <><span className="rounded-full bg-[#e5ede7] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.1em] text-[#476555]"><FlaskConical size={13} className="mr-1 inline" /> Observation running</span><button type="button" className={`${buttonClass} bg-[#ece7de] text-[#4e263f]`} onClick={() => pauseExperiment(selectedExperiment.id)} disabled={busy === "experiment"}>Pause</button></> : <button type="button" className={`${buttonClass} bg-[#de695c] text-white`} onClick={startExperiment} disabled={!selectedRun?.gate?.passed || !selectedCandidateId || busy === "experiment"}><Play size={13} /> Start observation</button>}</div></div>{data.experiments.length ? <div className="mt-5 grid gap-3 border-t border-[#ded8d0] pt-5 md:grid-cols-2">{data.experiments.map((experiment) => <div key={experiment.id} className="rounded-xl border border-[#ded8d0] bg-white p-4"><div className="flex items-center justify-between gap-3"><strong className="font-serif text-sm">{experiment.name}</strong><span className="rounded-full bg-[#e5ede7] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[.1em] text-[#476555]">{experiment.status}</span></div><small className="mt-2 block text-[10px] text-[#726c73]">{experiment.mode === "shadow" ? "Shadow" : `A/B · ${experiment.trafficPercent}% traffic`} · started {formatDate(experiment.startedAt)}</small></div>)}</div> : <EmptyLine label="No shadow or A/B experiment is running." />}</section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={`${panelClass} p-5 md:p-6`} aria-labelledby="approval-heading"><SectionHeading eyebrow="06 / Faculty" title="Approval checkpoint" icon={ShieldCheck} /><p className="mt-2 text-xs leading-5 text-[#726c73]">A named professor must approve the evaluated candidate in the Professor workspace. Admin cannot self-approve a release.</p>{selectedApproval ? <div className={`mt-5 rounded-xl border p-3 text-[10px] ${selectedApproval.decision === "approved" ? "border-[#b8d4c0] bg-[#e5ede7] text-[#365846]" : "border-[#f0bcb5] bg-[#fae9e7] text-[#842f2b]"}`}><strong>{selectedApproval.professorName ?? "Faculty"} · {selectedApproval.decision}</strong><p className="mt-1 leading-4">{selectedApproval.notes || "No notes provided."} · {formatDate(selectedApproval.createdAt)}</p></div> : <EmptyLine label="Waiting for an independent professor decision." />}</section>

        <section className={`${panelClass} p-5 md:p-6`} aria-labelledby="release-heading"><SectionHeading eyebrow="07 / Ship safely" title="Release and rollback" icon={RotateCcw} /><p className="mt-2 text-xs leading-5 text-[#726c73]">Release only after the offline gate and faculty checkpoint pass. Rollback returns traffic to the previous approved tutor version.</p><div className="mt-5 grid gap-3"><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Traffic percentage<input className={inputClass} type="number" min={1} max={25} value={trafficPercent} onChange={(event) => setTrafficPercent(Math.min(25, Math.max(1, Number(event.target.value) || 1)))} /></label><label className="grid gap-1.5 text-xs font-bold text-[#4e263f]">Release notes<textarea className={`${inputClass} min-h-20 resize-y`} value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} placeholder="Describe the approved change and monitoring plan." /></label><div className="grid gap-2 sm:grid-cols-2"><button type="button" className={`${buttonClass} bg-[#de695c] text-white`} disabled={busy === "release" || !selectedApproval || selectedApproval.decision !== "approved" || !selectedRun?.gate?.passed} onClick={releaseCandidate}><Send size={14} /> Release candidate</button><button type="button" className={`${buttonClass} bg-[#ece7de] text-[#4e263f]`} disabled={busy === "rollback" || !selectedRelease} onClick={rollbackRelease}><RotateCcw size={14} /> Roll back active</button></div></div>{selectedRelease ? <div className="mt-4 rounded-xl border border-[#b8d4c0] bg-[#e5ede7] p-3 text-[10px] text-[#365846]"><strong>Active release · {selectedRelease.trafficPercent}% traffic</strong><p className="mt-1 leading-4">Released {formatDate(selectedRelease.createdAt)} by {selectedRelease.releasedBy}. {selectedRelease.releaseNotes || "No release notes."}</p></div> : null}{data.releases.filter((item) => item.status === "rolled_back").length ? <div className="mt-4 border-t border-[#ded8d0] pt-4 text-[10px] text-[#726c73]">{data.releases.filter((item) => item.status === "rolled_back").length} previous release(s) retained for audit and rollback history.</div> : null}</section>
      </div>

      <p className="flex items-start gap-2 text-[10px] leading-4 text-[#726c73]"><CircleHelp size={14} className="mt-0.5 shrink-0 text-[#de695c]" /> Faculty feedback is de-identified before entering this lab. A candidate can influence tutor serving only after offline evaluation, shadow/A-B observation, and explicit faculty approval.</p>
    </section>
  );
}

function SectionHeading({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: typeof BarChart3 }) {
  return <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f5e9e7] text-[#be5048]"><Icon size={16} /></span><div><span className="section-kicker">{eyebrow}</span><h3 className="mt-1 font-serif text-2xl tracking-[-.025em] text-[#21172b]">{title}</h3></div></div>;
}

function StatCard({ icon: Icon, label, value, note }: { icon: typeof BarChart3; label: string; value: number; note: string }) {
  return <article className={`${panelClass} p-5`}><div className="flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#726c73]">{label}</span><Icon size={17} className="text-[#de695c]" /></div><strong className="mt-3 block font-serif text-4xl font-normal text-[#21172b]">{value}</strong><small className="mt-2 block text-[10px] leading-4 text-[#726c73]">{note}</small></article>;
}

function LoadingLine({ label }: { label: string }) {
  return <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-[#ded8d0] p-4 text-xs text-[#726c73]"><LoaderCircle size={14} className="spin" /> {label}</div>;
}

function EmptyLine({ label }: { label: string }) {
  return <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-[#ded8d0] p-4 text-xs leading-5 text-[#726c73]"><CircleHelp size={14} className="shrink-0 text-[#de695c]" /> {label}</div>;
}

export default FeedbackLab;
