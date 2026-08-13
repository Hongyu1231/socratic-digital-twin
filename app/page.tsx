"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Brain, Check, Clock3, Sparkles } from "lucide-react";
import type { StudentCaseOffering } from "@/lib/domain";

export default function CaseSelectionPage() {
  const router = useRouter();
  const [offerings, setOfferings] = useState<StudentCaseOffering[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

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
      });
    return () => controller.abort();
  }, []);

  function startCase(offering: StudentCaseOffering) {
    if (offering.existingSessionId) {
      router.push(`/session/${offering.existingSessionId}`);
      return;
    }
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: offering.assignment.id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "The session could not be started.");
        return;
      }
      router.push(`/session/${data.session.id}`);
    });
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
          <p>Choose from text-only teaching simulations assigned by your professor.</p>
        </div>

        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        {offerings.length === 0 && !error ? <div className="empty-state"><BookOpen /><h2>No assigned cases yet</h2><p>Your professor&apos;s open class assignments will appear here.</p></div> : null}
        <div className="case-grid">
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
              <button className="primary-button" onClick={() => startCase(offering)} disabled={pending || disabled}>
                {pending ? "Preparing session…" : offering.existingSessionId ? "Continue session" : offering.availability === "upcoming" ? "Opens soon" : offering.availability === "closed" ? "Assignment closed" : "Begin Socratic session"}
                <ArrowRight size={18} />
              </button>
            </article>
          );})}
          <div className="case-preview-card" aria-label="Future cases">
            <span>Coming next</span>
            <h3>More clinical reasoning pathways</h3>
            <p>Future cases will reuse the same tutor state machine with expert-authored rubrics.</p>
            <div className="preview-lines"><i /><i /><i /></div>
          </div>
        </div>
      </section>
    </div>
  );
}
