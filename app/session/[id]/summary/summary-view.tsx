"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Compass, LoaderCircle, ShieldCheck, Target } from "lucide-react";
import type { SessionBundle } from "@/lib/domain";

export function SessionSummaryView({ sessionId }: { sessionId: string }) {
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [error, setError] = useState("");
  const [openingReview, setOpeningReview] = useState(false);
  useEffect(() => {
    fetch(`/api/session/${sessionId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Summary could not be loaded.");
        return data;
      })
      .then(setBundle)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Summary could not be loaded."));
  }, [sessionId]);
  if (!bundle) return <div className="empty-state"><LoaderCircle className="spin" /><h2>Building your learning summary…</h2><p>{error}</p></div>;
  const summary = bundle.session.summary;
  if (!summary) return <div className="empty-state"><h2>This session is still active</h2><p>Complete or end the session to generate a summary.</p><Link className="primary-button" href={`/session/${sessionId}`}>Return to session</Link></div>;
  return (
    <div className="content-shell">
      <div className="page-title-row"><div><span className="section-kicker">Learning synthesis</span><h1>Session summary</h1></div><p>{bundle.case.title} · The score reflects expressed reasoning, not simply the final diagnosis.</p></div>
      <section className="summary-hero">
        <div className="score-disc"><div><strong>{summary.overallScore}</strong><small>Reasoning score</small></div></div>
        <div><span className="section-kicker">Tutor synthesis</span><h2>{summary.headline}</h2><p>{summary.narrative}</p></div>
      </section>
      <div className="summary-grid">
        <article className="insight-card"><ShieldCheck /><h3>Strengths</h3><ul>{summary.strengths.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article className="insight-card"><Target /><h3>Reasoning gaps</h3><ul>{summary.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul></article>
        <article className="insight-card"><Compass /><h3>Next steps</h3><ul>{summary.nextSteps.map((item) => <li key={item}>{item}</li>)}</ul></article>
      </div>
      <div className="summary-actions"><Link className="secondary-button" href="/">Choose another case</Link><button className="primary-button" disabled={openingReview} onClick={async () => {
        setOpeningReview(true);
        setError("");
        try {
          const identityResponse = await fetch("/api/demo/identity");
          const identityData = await identityResponse.json() as { users?: Array<{ id: string; role: string }> };
          const professor = identityData.users?.find((user) => user.role === "professor");
          if (!professor) throw new Error("No active professor identity is available.");
          const switchResponse = await fetch("/api/demo/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: professor.id }) });
          if (!switchResponse.ok) throw new Error("Professor identity could not be selected.");
          window.location.assign(`/professor/review/${sessionId}`);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Professor review could not be opened.");
          setOpeningReview(false);
        }
      }}>{openingReview ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}{openingReview ? "Opening review…" : "Open professor review"}</button></div>
      {error ? <p role="alert" className="mt-3 text-sm text-[#be5048]">{error}</p> : null}
    </div>
  );
}
