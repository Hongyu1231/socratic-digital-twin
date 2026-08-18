"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Compass, LoaderCircle, RotateCw, ShieldCheck, Target } from "lucide-react";
import type { SessionBundle } from "@/lib/domain";
import { describeRequestFailure, readJsonBody, requestSignal } from "@/lib/client-request";

const SUMMARY_TIMEOUT_MS = 30_000;

export function SessionSummaryView({ sessionId }: { sessionId: string }) {
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const retry = useCallback(() => {
    setError("");
    setReloadToken((token) => token + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/session/${sessionId}`, { signal: requestSignal(SUMMARY_TIMEOUT_MS, controller) })
      .then(async (response) => {
        const data = await readJsonBody<SessionBundle & { error?: string }>(response, "Summary could not be loaded.");
        if (!response.ok) throw new Error(data.error ?? "Summary could not be loaded.");
        return data;
      })
      .then(setBundle)
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(describeRequestFailure(reason, "Summary could not be loaded.", "Your summary is taking longer than expected to load."));
      });
    return () => controller.abort();
  }, [sessionId, reloadToken]);
  // A failed load is its own state: the spinner used to keep turning forever
  // with the error printed underneath it.
  if (error) {
    return (
      <div className="empty-state">
        <h2>Your summary could not be loaded</h2>
        <p role="alert">{error}</p>
        <button className="primary-button" type="button" onClick={retry}><RotateCw size={16} /> Try again</button>
      </div>
    );
  }
  if (!bundle) return <div className="empty-state"><LoaderCircle className="spin" /><h2>Building your learning summary…</h2></div>;
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
        <InsightCard icon={<ShieldCheck />} title="Strengths" items={summary.strengths} emptyMessage="The tutor did not single out a specific strength this time. That is a comment on one short session, not on you — work through the next steps and they are what the next summary will draw on." />
        <InsightCard icon={<Target />} title="Reasoning gaps" items={summary.weaknesses} emptyMessage="No specific gaps were recorded in this session. Keep making each step of your reasoning explicit so the tutor has something to test." />
        <InsightCard icon={<Compass />} title="Next steps" items={summary.nextSteps} emptyMessage="No next steps were generated for this session. Revisit the case, or ask your professor which part of the reasoning to practise first." />
      </div>
      <div className="summary-actions"><Link className="secondary-button" href="/">Choose another case</Link></div>
    </div>
  );
}

function InsightCard({ icon, title, items, emptyMessage }: { icon: ReactNode; title: string; items: string[]; emptyMessage: string }) {
  return (
    <article className="insight-card">
      {icon}
      <h3>{title}</h3>
      {items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="insight-empty">{emptyMessage}</p>}
    </article>
  );
}
