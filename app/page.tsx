"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Brain, Check, Clock3, LoaderCircle, Sparkles } from "lucide-react";
import type { StudentCaseOffering } from "@/lib/domain";

export default function CaseSelectionPage() {
  const router = useRouter();
  const [offerings, setOfferings] = useState<StudentCaseOffering[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cases", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cases could not be loaded.");
        return response.json() as Promise<{ offerings: StudentCaseOffering[] }>;
      })
      .then((data) => setOfferings(data.offerings ?? []))
      .catch((reason) => {
        if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function startCase(offering: StudentCaseOffering) {
    if (pendingAssignmentId) return;
    setPendingAssignmentId(offering.assignment.id);
    if (offering.existingSessionId) {
      if (offering.existingSessionStatus === "completed") {
        router.push(`/session/${offering.existingSessionId}/summary`);
        return;
      }
      if (!offering.existingSessionPausedAt) {
        router.push(`/session/${offering.existingSessionId}`);
        return;
      }
      setError("");
      try {
        const response = await fetch(`/api/session/${offering.existingSessionId}/resume`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "The paused session could not be resumed.");
          setPendingAssignmentId(null);
          return;
        }
        router.push(`/session/${offering.existingSessionId}`);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The paused session could not be resumed.");
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
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "The session could not be started.");
        setPendingAssignmentId(null);
        return;
      }
      router.push(`/session/${data.session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The session could not be started.");
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
            <span><Brain size={16} /> Flexible reasoning phases</span>
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

        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        {loading ? (
          <div className="case-grid case-grid-loading" aria-label="Loading assigned clinical cases" aria-busy="true">
            {[0, 1].map((item) => <article className="case-card case-card-skeleton" key={item} aria-hidden="true"><i /><i /><i /><i /><i /></article>)}
          </div>
        ) : null}
        {!loading && offerings.length === 0 && !error ? <div className="empty-state"><BookOpen /><h2>No assigned cases yet</h2><p>Your professor&apos;s open class assignments will appear here.</p></div> : null}
        {!loading ? <div className="case-grid">
          {offerings.map((offering, index) => {
            const clinicalCase = offering.case;
            const disabled = offering.availability !== "open" && !offering.existingSessionId;
            return (
            <article className="case-card" key={offering.assignment.id}>
              <div className="case-card-top">
                <div className="case-index">{String(index + 1).padStart(2, "0")}</div>
                <span className="difficulty-badge">{offering.availability}</span>
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
              <button className="primary-button" onClick={() => void startCase(offering)} disabled={Boolean(pendingAssignmentId) || disabled}>
                {pendingAssignmentId === offering.assignment.id ? <LoaderCircle size={18} className="spin" /> : null}
                {pendingAssignmentId === offering.assignment.id ? "Preparing session…" : offering.existingSessionPausedAt ? "Resume paused session" : offering.existingSessionStatus === "completed" ? "View learning summary" : offering.existingSessionId ? "Continue session" : offering.availability === "upcoming" ? "Opens soon" : offering.availability === "closed" ? "Assignment closed" : "Begin Socratic session"}
                {pendingAssignmentId === offering.assignment.id ? null : <ArrowRight size={18} />}
              </button>
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
