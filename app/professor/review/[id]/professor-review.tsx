"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, Check, Eye, LoaderCircle, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import type { Classification, SessionBundle } from "@/lib/domain";
import styles from "./review.module.css";

const labels: Classification[] = ["correct", "partial", "vague", "wrong"];
type DraftReview = { label: Classification; comments: string };

export function ProfessorReview({ sessionId }: { sessionId: string }) {
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftReview>>({});
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch(`/api/session/${sessionId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Review could not be loaded.");
        return data as SessionBundle;
      })
      .then((data) => {
        setBundle(data);
        setFeedback(data.sessionReview?.overallFeedback ?? "");
        setDrafts(Object.fromEntries(data.session.evaluations.map((evaluation) => {
          const existing = data.answerReviews.find((review) => review.evaluationId === evaluation.id);
          return [evaluation.id, { label: existing?.label ?? evaluation.classification, comments: existing?.comments ?? "" }];
        })));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Review could not be loaded."))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const turns = useMemo(() => {
    if (!bundle) return [];
    return bundle.session.evaluations.map((evaluation) => {
      const answerIndex = bundle.session.messages.findIndex((message) => message.id === evaluation.messageId);
      return { evaluation, answer: bundle.session.messages[answerIndex], question: bundle.session.messages.slice(0, answerIndex).toReversed().find((message) => message.sender === "ai") };
    });
  }, [bundle]);

  function save(status: "draft" | "completed") {
    if (!bundle || bundle.reviewClaim?.canEdit === false) return;
    setError(""); setSaved(false);
    startTransition(async () => {
      const response = await fetch("/api/professor/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reviews: bundle.session.evaluations.map((evaluation) => ({ evaluationId: evaluation.id, ...drafts[evaluation.id] })), overallFeedback: feedback, status }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setError("This review was claimed by another professor while you were working. Your fields are now read-only; refresh to see the current reviewer.");
          setBundle((current) => current ? { ...current, reviewClaim: { reviewerId: null, reviewerName: "another professor", state: "other", canEdit: false } } : current);
          return;
        }
        setError(data.error ?? "Review could not be saved.");
        return;
      }
      setBundle(data); setSaved(true);
    });
  }

  if (loading) return <div className="empty-state"><LoaderCircle className="spin" /><h2>Opening review workspace…</h2></div>;
  if (!bundle) return <div className="empty-state"><h2>Review unavailable</h2><p>{error || "This session could not be found or is outside your teaching classes."}</p><Link className="secondary-button" href="/professor">Return to dashboard</Link></div>;

  const claim = bundle.reviewClaim;
  const readOnly = claim?.canEdit === false;
  const claimedByOther = claim?.state === "other";
  const completed = claim?.state === "completed" || bundle.sessionReview?.status === "completed";
  const claimTitle = claimedByOther
    ? `Claimed by ${claim?.reviewerName ?? "another professor"}`
    : completed
      ? `Review completed${claim?.reviewerName ? ` by ${claim.reviewerName}` : ""}`
      : claim?.state === "mine"
        ? "This review is assigned to you"
        : "Ready to claim";

  return (
    <div className="content-shell">
      <div className="page-title-row"><div><Link className="table-link" href="/professor"><ArrowLeft size={14} /> Dashboard</Link><h1>Review &amp; scoring</h1></div><p>{bundle.student.name} · {bundle.case.title}{bundle.teachingClass ? ` · ${bundle.teachingClass.name}` : ""}</p></div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {saved ? <div className="success-banner" role="status"><Check size={15} /> Review saved</div> : null}
      <div className={`${styles.claimBanner} ${readOnly ? styles.readOnly : styles.editable}`} role="status">
        {readOnly ? <LockKeyhole size={18} /> : <ShieldCheck size={18} />}
        <div><strong>{claimTitle}</strong><span>{readOnly ? "You can inspect the transcript and faculty calibration, but cannot overwrite this review." : claim?.state === "mine" ? "Your draft is protected from edits by other professors." : "Saving a draft will atomically claim this review for you."}</span></div>
        <span className={styles.modeBadge}>{readOnly ? <><Eye size={12} /> Read only</> : "Editable"}</span>
      </div>
      <div className="review-layout">
        <section className="transcript-card"><span className="section-kicker">Conversation transcript</span>
          {turns.length === 0 ? <div className="empty-state"><p>No student answers have been submitted yet.</p></div> : turns.map(({ evaluation, answer, question }, index) => {
            const draft = drafts[evaluation.id] ?? { label: evaluation.classification, comments: "" };
            return <article className="review-turn" key={evaluation.id}>
              <span className="sidebar-label">Answer {index + 1}</span>
              <p className="review-question">{question?.content}</p>
              <div className="review-answer">{answer?.content}</div>
              <div className="ai-evaluation"><span><strong>AI evaluation:</strong> {evaluation.classification} · {Math.round(evaluation.confidence * 100)}% confidence</span><span><strong>Reasoning gap:</strong> {evaluation.reasoningGap}</span><span><strong>Strategy:</strong> {evaluation.strategy}</span></div>
              <div className="label-buttons" aria-label={`Professor label for answer ${index + 1}`}>{labels.map((label) => <button type="button" disabled={readOnly} aria-pressed={draft.label === label} className={draft.label === label ? "selected" : ""} key={label} onClick={() => setDrafts((current) => ({ ...current, [evaluation.id]: { ...draft, label } }))}>{label}</button>)}</div>
              <textarea readOnly={readOnly} aria-label={`Comments for answer ${index + 1}`} placeholder="Add an expert calibration note…" value={draft.comments} onChange={(event) => setDrafts((current) => ({ ...current, [evaluation.id]: { ...draft, comments: event.target.value } }))} />
            </article>;
          })}
        </section>
        <aside className="review-panel"><span className="section-kicker">Learner model</span><div className="memory-list"><div><span>Strengths</span><p>{bundle.session.state.strengths.join(" · ") || "Not enough evidence yet"}</p></div><div><span>Weak areas</span><p>{bundle.session.state.weaknesses.join(" · ") || "Not enough evidence yet"}</p></div><div><span>Previous errors</span><p>{bundle.session.state.previousErrors.join(" · ") || "None recorded"}</p></div><div><span>AI score</span><p>{bundle.session.score ?? "In progress"} / 100</p></div></div>
          <label className="sidebar-label" htmlFor="overall-feedback">Overall feedback</label><textarea id="overall-feedback" readOnly={readOnly} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Summarise the student's clinical reasoning…" />
          {readOnly ? <p className={styles.readOnlyNote}><LockKeyhole size={13} /> This completed or claimed review cannot be edited.</p> : <div className="review-actions"><button type="button" className="secondary-button" disabled={pending} onClick={() => save("draft")}><Save size={15} /> Save draft</button><button type="button" className="primary-button" disabled={pending} onClick={() => save("completed")}><Check size={15} /> Complete review</button></div>}
        </aside>
      </div>
    </div>
  );
}
