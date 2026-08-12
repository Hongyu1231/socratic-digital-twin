"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Info, LoaderCircle } from "lucide-react";
import type { SessionBundle, TutorMessage } from "@/lib/domain";

export function SocraticChat({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<TutorMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/session/${sessionId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Session could not be loaded.");
        return data as SessionBundle;
      })
      .then((data) => {
        setBundle(data);
        if (data.session.status === "completed") router.replace(`/session/${sessionId}/summary`);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Session could not be loaded."));
  }, [router, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bundle?.session.messages.length, optimisticMessage?.id, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = answer.trim();
    if (!message || pending) return;
    const clientRequestId = crypto.randomUUID();

    setAnswer("");
    setError("");
    setOptimisticMessage({
      id: `optimistic-${clientRequestId}`,
      sessionId,
      sender: "student",
      content: message,
      timestamp: new Date().toISOString(),
    });
    setPending(true);

    try {
      const response = await fetch("/api/session/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message, clientRequestId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Your answer could not be evaluated.");
      }
      setBundle(data as SessionBundle);
      if (data.session.status === "completed") router.push(`/session/${sessionId}/summary`);
    } catch (reason) {
      setAnswer(message);
      setError(reason instanceof Error ? reason.message : "Your answer could not be evaluated.");
    } finally {
      setOptimisticMessage(null);
      setPending(false);
    }
  }

  async function endSession() {
    if (!window.confirm("End this session now? Your summary will reflect the phases completed so far.")) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/session/${sessionId}/complete`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The session could not be ended.");
      router.push(`/session/${sessionId}/summary`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The session could not be ended.");
      setPending(false);
    }
  }

  if (!bundle) {
    return <div className="empty-state"><LoaderCircle className="spin" /><h2>Preparing your reasoning space…</h2><p>{error || "Retrieving the case and learner state."}</p></div>;
  }

  const { session, case: clinicalCase } = bundle;
  const currentPhase = clinicalCase.phases.find((phase) => phase.order === session.currentPhase)!;
  const progress = Math.round((session.currentPhase / clinicalCase.phases.length) * 100);
  const visibleMessages = optimisticMessage
    ? [...session.messages, optimisticMessage]
    : session.messages;

  return (
    <div className="session-shell">
      <aside className="session-sidebar" aria-label="Case information">
        <span className="sidebar-label">Active case</span>
        <h2>{clinicalCase.title}</h2>
        <p>{clinicalCase.description}</p>
        <ul className="goal-list" aria-label="Learning phases">
          {clinicalCase.phases.map((phase) => (
            <li key={phase.id} className={phase.order < session.currentPhase ? "done" : phase.order === session.currentPhase ? "active" : ""}>
              <span className="goal-number">{phase.order < session.currentPhase ? <Check size={11} /> : phase.order}</span>
              <span>{phase.title}</span>
            </li>
          ))}
        </ul>
        <div className="safety-note"><Info size={13} /> Teaching simulation only. No real patient data or clinical diagnosis is used.</div>
      </aside>

      <section className="chat-panel" aria-label="Socratic conversation">
        <header className="chat-topbar">
          <div><span className="sidebar-label">Phase {session.currentPhase} of {clinicalCase.phases.length}</span><br /><strong>{currentPhase.title}</strong></div>
          <span className="runtime-badge">
            {bundle.runtime.tutor === "openai"
              ? "OpenAI live"
              : bundle.runtime.tutor === "claude"
                ? "Claude live"
                : "Demo tutor"}
          </span>
        </header>
        <div className="message-list" aria-live="polite">
          {visibleMessages.map((message) => (
            <article className={`message ${message.sender}`} key={message.id}>
              {message.sender === "ai" ? <div className="message-avatar">S</div> : null}
              <div>
                <div className="message-bubble">{message.content}</div>
                <span className="message-meta">{message.sender === "ai" ? "Socratic tutor" : "Your reasoning"}</span>
              </div>
              {message.sender === "student" ? <div className="message-avatar">A</div> : null}
            </article>
          ))}
          {pending ? <article className="message"><div className="message-avatar">S</div><div><div className="message-bubble thinking"><i /><i /><i /></div><span className="message-meta">Examining your reasoning</span></div></article> : null}
          <div ref={bottomRef} />
        </div>
        <form className="chat-composer" onSubmit={submit}>
          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          <div className="composer-box">
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Explain what you think, and why…"
              aria-label="Your clinical reasoning"
              maxLength={2000}
              disabled={pending}
            />
            <div className="composer-actions"><small>Enter to send · Shift + Enter for a new line</small><button className="send-button" disabled={!answer.trim() || pending} aria-label="Send answer"><ArrowUp size={18} /></button></div>
          </div>
        </form>
      </section>

      <aside className="session-sidebar right" aria-label="Session progress">
        <span className="sidebar-label">Session progress</span>
        <div className="progress-orbit" style={{ "--progress": `${progress}%` } as React.CSSProperties}><div><strong>{progress}%</strong><small>Complete</small></div></div>
        <div className="phase-card"><span>Current goal</span><strong>{currentPhase.title}</strong><p>{currentPhase.goal}</p></div>
        <button className="end-session" onClick={endSession} disabled={pending}>End session &amp; view summary</button>
      </aside>
    </div>
  );
}
