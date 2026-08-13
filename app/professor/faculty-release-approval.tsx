"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, LoaderCircle, ShieldAlert, XCircle } from "lucide-react";

type Run = { id: string; candidateId: string; status: string; gate?: { passed: boolean; reasons: string[] }; candidateMetrics?: { exactAgreement?: number | null; meanTutorQuality?: number | null; humanizationPassRate?: number | null } };
type Candidate = { id: string; name: string; model: string; promptVersion: string };
type Approval = { evalRunId: string; decision: "approved" | "rejected"; notes: string };

export default function FacultyReleaseApproval() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/professor/humanization/approvals", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setRuns(body.runs ?? []);
      setCandidates(body.candidates ?? []);
      setApprovals(body.approvals ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load candidates.");
    }
  }

  useEffect(() => { void load(); }, []);
  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);

  async function decide(runId: string, decision: "approved" | "rejected") {
    const value = notes[runId]?.trim();
    if (!value || value.length < 10) { setError("Add a faculty rationale of at least 10 characters."); return; }
    setBusy(runId); setError("");
    try {
      const response = await fetch("/api/professor/humanization/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evalRunId: runId, decision, notes: value }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Approval failed."); }
    finally { setBusy(""); }
  }

  return <section className="rounded-[3px_22px_3px_3px] border border-[#ded8d0] bg-[#fffdfa] p-6 shadow-[0_16px_45px_rgba(48,28,43,.06)]" aria-labelledby="faculty-release-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="section-kicker">Faculty governance</span><h2 id="faculty-release-heading" className="mt-2 font-serif text-3xl">Tutor release approval</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-[#726c73]">Review candidates only after frozen evaluation, shadow observation, and recorded limited A/B evidence. Approval never trains the model online or changes a learner&apos;s recorded state.</p></div><FlaskConical className="text-[#de695c]" /></div>
    {error ? <div className="error-banner mt-4" role="alert">{error}</div> : null}
    <div className="mt-5 grid gap-4">{runs.length === 0 ? <p className="text-sm text-[#726c73]">No candidate with recorded limited A/B evidence awaits faculty governance.</p> : runs.map((run) => {
      const candidate = candidateById.get(run.candidateId);
      const prior = approvals.find((approval) => approval.evalRunId === run.id);
      return <article key={run.id} className="rounded-xl border border-[#ded8d0] bg-[#f6f3ed] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="font-serif text-lg">{candidate?.name ?? "Tutor candidate"}</strong><small className="ml-2 font-mono text-[10px] text-[#726c73]">{candidate?.model} · {candidate?.promptVersion}</small></div><span className="status-badge">{run.gate?.passed ? "gate passed" : "gate blocked"}</span></div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs"><span>Agreement <strong>{Math.round((run.candidateMetrics?.exactAgreement ?? 0) * 100)}%</strong></span><span>Historical faculty quality <strong>not transferred</strong></span><span>Structured QA <strong>{Math.round((run.candidateMetrics?.humanizationPassRate ?? 0) * 100)}%</strong></span></div>
        {prior ? <p className="mt-3 text-xs font-bold">Your decision: {prior.decision}</p> : <><textarea aria-label={`Faculty rationale for ${candidate?.name ?? run.id}`} className="mt-4 min-h-20 w-full rounded-lg border border-[#ded8d0] bg-white p-3 text-xs" placeholder="Explain the observed A/B evidence supporting approval or rejection…" value={notes[run.id] ?? ""} onChange={(event) => setNotes({ ...notes, [run.id]: event.target.value })}/><div className="mt-3 flex justify-end gap-2"><button className="secondary-button" disabled={busy === run.id} onClick={() => void decide(run.id, "rejected")}><XCircle size={14}/> Reject</button><button className="primary-button" disabled={!run.gate?.passed || busy === run.id} onClick={() => void decide(run.id, "approved")}>{busy === run.id ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} Approve</button></div></>}
      </article>;
    })}</div>
    <div className="mt-5 flex items-start gap-2 rounded-lg bg-[#4e263f] p-3 text-xs text-white/85"><ShieldAlert size={16} className="shrink-0"/><span>A candidate still requires a passed gate, observed A/B evidence, and Admin release. A single professor comment can never publish it.</span></div>
  </section>;
}
