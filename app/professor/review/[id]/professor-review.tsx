"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Eye, LoaderCircle, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import type { Classification, SessionBundle, TutorQualityFailureTag } from "@/lib/domain";
import { projectProfessorTranscript } from "@/lib/professor/transcript";
import styles from "./review.module.css";

const labels: Classification[] = ["correct", "partial", "vague", "wrong"];
type DraftReview = { label: Classification; comments: string };
type TutorDraft = {
  tutorMessageId: string;
  naturalness: number;
  specificity: number;
  nonLeading: number;
  challengeFit: number;
  helpfulness: number;
  failureTags: TutorQualityFailureTag[];
  preferredRewrite: string;
  comments: string;
};

const qualityDimensions = [
  ["naturalness", "Naturalness"],
  ["specificity", "Specificity"],
  ["nonLeading", "Non-leading"],
  ["challengeFit", "Challenge fit"],
  ["helpfulness", "Helpfulness"],
] as const;

const failureTags: Array<[TutorQualityFailureTag, string]> = [
  ["generic", "Generic"], ["repetitive", "Repetitive"], ["leading", "Leading"],
  ["multi_part", "Multi-part"], ["too_difficult", "Too difficult"], ["too_easy", "Too easy"],
  ["mini_lecture", "Mini-lecture"], ["diagnosis_leak", "Diagnosis leak"], ["not_grounded", "Not grounded"],
];

export function ProfessorReview({ sessionId }: { sessionId: string }) {
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftReview>>({});
  const [tutorDrafts, setTutorDrafts] = useState<Record<string, TutorDraft>>({});
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<"draft" | "completed" | null>(null);

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
        setDrafts(Object.fromEntries(data.session.evaluations.filter((evaluation) => !evaluation.isReflection).map((evaluation) => {
          const existing = data.answerReviews.find((review) => review.evaluationId === evaluation.id);
          return [evaluation.id, { label: existing?.label ?? evaluation.classification, comments: existing?.comments ?? "" }];
        })));
        const transcript = projectProfessorTranscript(data.session);
        setTutorDrafts(Object.fromEntries(data.session.evaluations.flatMap((evaluation) => {
          const turn = transcript.find((item) => item.kind !== "context" && item.kind !== "help" && item.evaluation?.id === evaluation.id);
          const tutorMessage = turn && "tutorReply" in turn ? turn.tutorReply : undefined;
          if (!tutorMessage) return [];
          const existing = data.tutorTurnReviews.find((review) => review.evaluationId === evaluation.id);
          return [[evaluation.id, existing ? {
            tutorMessageId: existing.tutorMessageId,
            naturalness: existing.naturalness,
            specificity: existing.specificity,
            nonLeading: existing.nonLeading,
            challengeFit: existing.challengeFit,
            helpfulness: existing.helpfulness,
            failureTags: existing.failureTags,
            preferredRewrite: existing.preferredRewrite,
            comments: existing.comments,
          } : {
            tutorMessageId: tutorMessage.id,
            naturalness: 3,
            specificity: 3,
            nonLeading: 3,
            challengeFit: 3,
            helpfulness: 3,
            failureTags: [],
            preferredRewrite: "",
            comments: "",
          }]];
        })));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Review could not be loaded."))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const turns = useMemo(() => {
    return bundle ? projectProfessorTranscript(bundle.session) : [];
  }, [bundle]);

  async function save(status: "draft" | "completed") {
    if (!bundle || bundle.reviewClaim?.canEdit === false) return;
    setError(""); setSaved(false);
    setSavingStatus(status);
    try {
      const response = await fetch("/api/professor/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          reviews: bundle.session.evaluations.filter((evaluation) => !evaluation.isReflection).map((evaluation) => ({ evaluationId: evaluation.id, ...drafts[evaluation.id] })),
          tutorReviews: bundle.session.evaluations.flatMap((evaluation) => tutorDrafts[evaluation.id] ? [{ evaluationId: evaluation.id, ...tutorDrafts[evaluation.id] }] : []),
          overallFeedback: feedback,
          status,
        }),
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review could not be saved.");
    } finally {
      setSavingStatus(null);
    }
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
          {turns.length === 0 ? <div className="empty-state"><p>No student answers have been submitted yet.</p></div> : turns.map((turn) => {
            if (turn.kind === "context") {
              return <article className={`review-turn ${styles.contextTurn}`} key={turn.id}>
                <span className="sidebar-label">Opening tutor context</span>
                <div className={styles.contextMessage}>{turn.tutorMessage.content}</div>
              </article>;
            }

            if (turn.kind === "help") {
              return <article className={`review-turn ${styles.helpTurn}`} key={turn.id}>
                <span className="sidebar-label">Help requested</span>
                {turn.question ? <p className="review-question">{turn.question.content}</p> : null}
                <div className={styles.helpMarker}>{turn.marker.content}</div>
                <div className="ai-evaluation" role="status">
                  <span><strong>Ungraded Help:</strong> {turn.tutorReply?.content ?? "No tutor reply recorded."}</span>
                  {turn.phaseOrder !== undefined ? <span><strong>Phase:</strong> {turn.phaseOrder}</span> : null}
                  {turn.supportLevel !== undefined ? <span><strong>Support level:</strong> {turn.supportLevel}</span> : null}
                  {turn.completedWithSupport !== undefined ? <span><strong>Tutor support recorded:</strong> {turn.completedWithSupport ? "Yes" : "No"} · Help does not itself complete the phase.</span> : null}
                </div>
              </article>;
            }

            const { answer, evaluation, question, tutorReply } = turn;
            const isReflection = turn.kind === "reflection";
            const draft = evaluation ? drafts[evaluation.id] ?? { label: evaluation.classification, comments: "" } : null;
            const tutorDraft = evaluation ? tutorDrafts[evaluation.id] : undefined;
            const answerLabel = turn.kind === "reflection" ? "Final reflection" : `Answer ${turn.answerNumber}`;
            const turnLabel = turn.kind === "reflection" ? "final reflection" : `answer ${turn.answerNumber}`;
            return <article className="review-turn" key={turn.id}>
              <span className="sidebar-label">{answerLabel}</span>
              {question ? <p className="review-question">{question.content}</p> : null}
              <div className="review-answer">{answer.content}</div>
              {isReflection ? <div className="ai-evaluation" role="status"><span><strong>Final reflection:</strong> Not graded for the learner score or professor answer label.</span><span>This reflection remains in the transcript and can still inform tutor intervention review.</span></div> : evaluation && draft ? <><div className="ai-evaluation"><span><strong>AI evaluation:</strong> {evaluation.classification} · {Math.round(evaluation.confidence * 100)}% confidence</span><span><strong>Reasoning gap:</strong> {evaluation.reasoningGap}</span><span><strong>Strategy:</strong> {evaluation.strategy}</span>{evaluation.promptVersion ? <span><strong>Experiment:</strong> {evaluation.provider} · {evaluation.model} · {evaluation.promptVersion} · phase {evaluation.phaseOrder} attempt {evaluation.attempt}</span> : null}</div>
                <div className="label-buttons" aria-label={`Professor label for ${turnLabel}`}>{labels.map((label) => <button type="button" disabled={readOnly} aria-pressed={draft.label === label} className={draft.label === label ? "selected" : ""} key={label} onClick={() => setDrafts((current) => ({ ...current, [evaluation.id]: { ...draft, label } }))}>{label}</button>)}</div>
                <textarea readOnly={readOnly} aria-label={`Comments for ${turnLabel}`} placeholder="Add an expert calibration note…" value={draft.comments} onChange={(event) => setDrafts((current) => ({ ...current, [evaluation.id]: { ...draft, comments: event.target.value } }))} /></> : <div className="ai-evaluation" role="status"><span><strong>No evaluation recorded:</strong> This answer remains in the chronological transcript without an answer-review control.</span></div>}
              {tutorDraft && tutorReply && evaluation ? <section className={styles.tutorQuality} aria-label={`Tutor quality for ${turnLabel}`}>
                <div className={styles.qualityHeading}><span className="sidebar-label">Tutor intervention quality</span><strong>{tutorReply.content}</strong></div>
                <div className={styles.qualityGrid}>{qualityDimensions.map(([key, label]) => <div className={styles.ratingRow} key={key}><span>{label}</span><div aria-label={`${label} rating for ${turnLabel}`}>{[1, 2, 3, 4, 5].map((rating) => <button type="button" disabled={readOnly} aria-pressed={tutorDraft[key] === rating} className={tutorDraft[key] === rating ? styles.ratingSelected : ""} key={rating} onClick={() => setTutorDrafts((current) => ({ ...current, [evaluation.id]: { ...tutorDraft, [key]: rating } }))}>{rating}</button>)}</div></div>)}</div>
                <div className={styles.tagList} aria-label={`Tutor failure tags for ${turnLabel}`}>{failureTags.map(([tag, label]) => { const selected = tutorDraft.failureTags.includes(tag); return <button type="button" disabled={readOnly} aria-pressed={selected} className={selected ? styles.tagSelected : ""} key={tag} onClick={() => setTutorDrafts((current) => ({ ...current, [evaluation.id]: { ...tutorDraft, failureTags: selected ? tutorDraft.failureTags.filter((item) => item !== tag) : [...tutorDraft.failureTags, tag] } }))}>{label}</button>; })}</div>
                <textarea readOnly={readOnly} aria-label={`Preferred tutor rewrite for ${turnLabel}`} placeholder="Optional: rewrite the tutor response as you would say it…" value={tutorDraft.preferredRewrite} onChange={(event) => setTutorDrafts((current) => ({ ...current, [evaluation.id]: { ...tutorDraft, preferredRewrite: event.target.value } }))} />
                <textarea readOnly={readOnly} aria-label={`Tutor quality comments for ${turnLabel}`} placeholder="Why was this tutor move helpful or unhelpful?" value={tutorDraft.comments} onChange={(event) => setTutorDrafts((current) => ({ ...current, [evaluation.id]: { ...tutorDraft, comments: event.target.value } }))} />
              </section> : null}
            </article>;
          })}
        </section>
        <aside className="review-panel"><span className="section-kicker">Learner model</span><div className="memory-list"><div><span>Strengths</span><p>{bundle.session.state.strengths.join(" · ") || "Not enough evidence yet"}</p></div><div><span>Weak areas</span><p>{bundle.session.state.weaknesses.join(" · ") || "Not enough evidence yet"}</p></div><div><span>Previous errors</span><p>{bundle.session.state.previousErrors.join(" · ") || "None recorded"}</p></div><div><span>AI score</span><p>{bundle.session.score ?? "In progress"} / 100</p></div></div>
          <label className="sidebar-label" htmlFor="overall-feedback">Overall feedback</label><textarea id="overall-feedback" readOnly={readOnly} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Summarise the student's clinical reasoning…" />
          {readOnly ? <p className={styles.readOnlyNote}><LockKeyhole size={13} /> This completed or claimed review cannot be edited.</p> : <div className="review-actions"><button type="button" className="secondary-button" disabled={Boolean(savingStatus)} onClick={() => void save("draft")}>{savingStatus === "draft" ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} {savingStatus === "draft" ? "Saving…" : "Save draft"}</button><button type="button" className="primary-button" disabled={Boolean(savingStatus)} onClick={() => void save("completed")}>{savingStatus === "completed" ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} {savingStatus === "completed" ? "Completing…" : "Complete review"}</button></div>}
        </aside>
      </div>
    </div>
  );
}
