"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Brain, Check, Clock3, LoaderCircle, RotateCw, Sparkles } from "lucide-react";
import type { StudentCaseOffering } from "@/lib/domain";
import { describeRequestFailure, readJsonBody, requestSignal } from "@/lib/client-request";
import { groupByCase, sessionLabel } from "@/lib/case-catalogue";

// The offerings query is slow enough on a cold backend that an aggressive
// deadline would abort requests that were about to succeed.
const CASES_TIMEOUT_MS = 30_000;
const SLOW_NOTICE_MS = 6_000;

export default function CaseSelectionPage() {
  const router = useRouter();
  const [offerings, setOfferings] = useState<StudentCaseOffering[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<string | null>(null);
  const groups = useMemo(() => groupByCase(offerings), [offerings]);

  const retry = useCallback(() => {
    setLoading(true);
    setError("");
    setSlow(false);
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const slowNotice = setTimeout(() => setSlow(true), SLOW_NOTICE_MS);
    fetch("/api/cases", { signal: requestSignal(CASES_TIMEOUT_MS, controller) })
      .then(async (response) => {
        const data = await readJsonBody<{ offerings?: StudentCaseOffering[]; error?: string }>(response, "Cases could not be loaded.");
        if (!response.ok) throw new Error(data.error ?? "Cases could not be loaded.");
        return data;
      })
      .then((data) => setOfferings(data.offerings ?? []))
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(describeRequestFailure(reason, "Cases could not be loaded.", "Your assigned cases are taking longer than expected to load."));
      })
      .finally(() => {
        clearTimeout(slowNotice);
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      clearTimeout(slowNotice);
      controller.abort();
    };
  }, [reloadToken]);

  async function startCase(offering: StudentCaseOffering) {
    if (pendingAssignmentId) return;
    setPendingAssignmentId(offering.assignment.id);
    if (offering.existingSessionId) {
      if (!offering.existingSessionPausedAt) {
        router.push(`/session/${offering.existingSessionId}`);
        return;
      }
      setError("");
      try {
        const response = await fetch(`/api/session/${offering.existingSessionId}/resume`, { method: "POST" });
        const data = await readJsonBody<{ error?: string }>(response, "The paused session could not be resumed.");
        if (!response.ok) {
          setError(data.error ?? "The paused session could not be resumed.");
          setPendingAssignmentId(null);
          return;
        }
        router.push(`/session/${offering.existingSessionId}`);
      } catch (reason) {
        setError(describeRequestFailure(reason, "The paused session could not be resumed.", "Resuming the session is taking longer than expected. Please try again."));
        setPendingAssignmentId(null);
      }
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: offering.assignment.id }),
      });
      const data = await readJsonBody<{ session?: { id: string }; error?: string }>(response, "The session could not be started.");
      if (!response.ok || !data.session) {
        setError(data.error ?? "The session could not be started.");
        setPendingAssignmentId(null);
        return;
      }
      router.push(`/session/${data.session.id}`);
    } catch (reason) {
      setError(describeRequestFailure(reason, "The session could not be started.", "Starting the session is taking longer than expected. Please try again."));
      setPendingAssignmentId(null);
    }
  }

  return (
    <div className="page-shell home-shell">
      <section className="hero-grid" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> Clinical reasoning, made visible</div>
          <h1 id="hero-title">Learn to think.<br /><em>Not just answer.</em></h1>
          <p>
            A Socratic AI tutor that listens for the reasoning behind your conclusion,
            challenges assumptions and helps you build a defensible clinical pathway.
          </p>
          <div className="hero-meta" aria-label="Session attributes">
            <span><Clock3 size={16} /> 15–20 minutes</span>
            <span><Brain size={16} /> 5 reasoning phases</span>
            <span><BookOpen size={16} /> Formative assessment</span>
          </div>
        </div>
        <aside className="principle-card">
          <span className="principle-number">01</span>
          <blockquote>“What evidence would make you change your mind?”</blockquote>
          <p>The tutor guides with questions before offering conclusions.</p>
          <div className="reasoning-line" aria-hidden="true">
            <span>Observe</span><i /><span>Interpret</span><i /><span>Decide</span>
          </div>
        </aside>
      </section>

      <section className="case-section" aria-labelledby="cases-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Available simulation</span>
            <h2 id="cases-title">Choose a clinical case</h2>
          </div>
          <p>Choose from multimedia teaching simulations assigned by your professor.</p>
        </div>

        {error ? (
          <div className="load-failure" role="alert">
            <div className="error-banner">{error}</div>
            <button className="secondary-button" type="button" onClick={retry}><RotateCw size={16} /> Try again</button>
          </div>
        ) : null}
        {loading ? (
          <>
            {slow ? <p className="loading-notice" role="status">Still loading your assigned cases. This can take a moment on the first visit.</p> : null}
            <div className="case-grid case-grid-loading" aria-label="Loading assigned clinical cases" aria-busy="true">
              {[0, 1].map((item) => <article className="case-card case-card-skeleton" key={item} aria-hidden="true"><i /><i /><i /><i /><i /></article>)}
            </div>
          </>
        ) : null}
        {!loading && groups.length === 0 && !error ? <div className="empty-state"><BookOpen /><h2>No assigned cases yet</h2><p>Your professor&apos;s open class assignments will appear here.</p></div> : null}
        {!loading && !error ? <div className="case-grid">
          {groups.map(({ primary: offering, extras }, index) => {
            const clinicalCase = offering.case;
            const disabled = offering.availability !== "open" && !offering.existingSessionId;
            return (
            <article className="case-card" key={clinicalCase.id}>
              <div className="case-card-top">
                <div className="case-index">{String(index + 1).padStart(2, "0")}</div>
                <span className="difficulty-badge">{clinicalCase.status === "available" ? offering.availability : `${clinicalCase.status} by your professor`}</span>
              </div>
              <h3>{clinicalCase.title}</h3>
              <p><strong>{offering.teachingClass.name}</strong> · {offering.teachingClass.term}</p>
              <p>{clinicalCase.description}</p>
              <div className="objectives-mini">
                <span>Learning focus</span>
                <ul>
                  {clinicalCase.learningObjectives.slice(0, 3).map((objective) => (
                    <li key={objective}><Check size={14} /> {objective}</li>
                  ))}
                </ul>
              </div>
              {offering.existingSessionStatus === "completed" && offering.existingSessionId ? (
                // A link rather than a button: the route is prefetched, so the
                // transition commits immediately instead of stalling on a click.
                <Link className="primary-button" href={`/session/${offering.existingSessionId}/summary`}>
                  View learning summary <ArrowRight size={18} />
                </Link>
              ) : (
                <button className="primary-button" onClick={() => void startCase(offering)} disabled={Boolean(pendingAssignmentId) || disabled}>
                  {pendingAssignmentId === offering.assignment.id ? <LoaderCircle size={18} className="spin" /> : null}
                  {pendingAssignmentId === offering.assignment.id ? "Preparing session…" : offering.existingSessionPausedAt ? "Resume paused session" : offering.existingSessionId ? "Continue session" : offering.availability === "upcoming" ? "Opens soon" : offering.availability === "closed" ? "Assignment closed" : "Begin Socratic session"}
                  {pendingAssignmentId === offering.assignment.id ? null : <ArrowRight size={18} />}
                </button>
              )}
              {extras.length ? (
                <div className="case-extra-sessions">
                  <span>Your other sessions on this case</span>
                  <ul>
                    {extras.map((extra) => (
                      <li key={extra.assignment.id}>
                        <span>{sessionLabel(extra)} <small>#{extra.existingSessionId?.slice(0, 6)}</small></span>
                        {extra.existingSessionStatus === "completed" && extra.existingSessionId ? (
                          <Link href={`/session/${extra.existingSessionId}/summary`}>View summary</Link>
                        ) : (
                          <button type="button" onClick={() => void startCase(extra)} disabled={Boolean(pendingAssignmentId)}>
                            {pendingAssignmentId === extra.assignment.id ? "Opening…" : extra.existingSessionPausedAt ? "Resume" : "Continue"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          );})}
          <div className="case-preview-card" aria-label="Future cases">
            <span>Coming next</span>
            <h3>More clinical reasoning pathways</h3>
            <p>Future cases will reuse the same tutor state machine with expert-authored rubrics.</p>
            <div className="preview-lines"><i /><i /><i /></div>
          </div>
        </div> : null}
      </section>
    </div>
  );
}
