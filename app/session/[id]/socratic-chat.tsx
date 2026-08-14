"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, Check, Info, LoaderCircle, Mic, MicOff, PauseCircle, Play, Volume2, VolumeX, X } from "lucide-react";
import type { SessionBundle, TutorMessage } from "@/lib/domain";
import { CaseResources } from "@/components/case-resources";

interface BrowserSpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}

interface BrowserSpeechRecognitionEvent extends Event {
  readonly results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function SocraticChat({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<TutorMessage | null>(null);
  const [listening, setListening] = useState(false);
  const [speechInputAvailable, setSpeechInputAvailable] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const [mobileCaseOpen, setMobileCaseOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceBaseRef = useRef("");
  const lastAutoReadRef = useRef<string | null>(null);

  useEffect(() => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechInputAvailable(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

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

  useEffect(() => {
    if (!autoRead || pending || !bundle || !("speechSynthesis" in window)) return;
    const latestTutorMessage = [...bundle.session.messages].reverse().find((message) => message.sender === "ai");
    if (!latestTutorMessage || latestTutorMessage.id === lastAutoReadRef.current) return;
    lastAutoReadRef.current = latestTutorMessage.id;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(latestTutorMessage.content);
    utterance.lang = "en-SG";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);
    setSpeakingMessageId(latestTutorMessage.id);
    window.speechSynthesis.speak(utterance);
  }, [autoRead, bundle, pending]);

  function toggleSpeechInput() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Voice input is not supported by this browser. You can continue typing your answer.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-SG";
    recognition.continuous = false;
    recognition.interimResults = true;
    voiceBaseRef.current = answer.trim();
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      setAnswer([voiceBaseRef.current, transcript].filter(Boolean).join(" "));
    };
    recognition.onerror = (event) => {
      setListening(false);
      recognitionRef.current = null;
      setError(event.error === "not-allowed" ? "Microphone access was not granted. Allow microphone access or continue typing." : "Voice input stopped unexpectedly. Please try again or continue typing.");
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    setError("");
    setListening(true);
    recognitionRef.current = recognition;
    recognition.start();
  }

  function readTutorMessage(message: TutorMessage) {
    if (!("speechSynthesis" in window)) {
      setError("Read-aloud is not supported by this browser.");
      return;
    }
    if (speakingMessageId === message.id) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.lang = "en-SG";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);
    setSpeakingMessageId(message.id);
    window.speechSynthesis.speak(utterance);
  }

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

  async function pauseSession() {
    if (pending) return;
    setPending(true);
    setError("");
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
    try {
      const response = await fetch(`/api/session/${sessionId}/pause`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The session could not be paused.");
      router.push("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The session could not be paused.");
      setPending(false);
    }
  }

  async function resumeSession() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/session/${sessionId}/resume`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The session could not be resumed.");
      setBundle(data as SessionBundle);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The session could not be resumed.");
    } finally {
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
        <CaseResources clinicalCase={clinicalCase} />
      </aside>

      <section className="chat-panel" aria-label="Socratic conversation">
        <header className="chat-topbar">
          <div><span className="sidebar-label">Phase {session.currentPhase} of {clinicalCase.phases.length}</span><br /><strong>{currentPhase.title}</strong></div>
          <div className="session-top-actions">
            <button className="mobile-case-button" type="button" onClick={() => setMobileCaseOpen(true)}><BookOpen size={14} /><span>Case</span></button>
            <button className="mobile-pause-button" type="button" onClick={pauseSession} disabled={pending || Boolean(session.pausedAt)}><PauseCircle size={14} /><span>Pause</span></button>
            <button className="mobile-end-button" type="button" onClick={endSession} disabled={pending}>End</button>
            <button className="voice-toggle" type="button" aria-pressed={autoRead} onClick={() => { setAutoRead((value) => !value); if (autoRead) { window.speechSynthesis?.cancel(); setSpeakingMessageId(null); } }} title="Automatically read new tutor replies aloud">
              {autoRead ? <Volume2 size={14} /> : <VolumeX size={14} />} <span>{autoRead ? "Auto-read on" : "Auto-read off"}</span>
            </button>
            <span className="runtime-badge">
              {bundle.runtime.tutor === "openai"
                ? "OpenAI live"
                : bundle.runtime.tutor === "claude"
                  ? "Claude live"
                  : "Demo tutor"}
            </span>
          </div>
        </header>
        <div className="message-list" aria-live="polite">
          {visibleMessages.map((message) => (
            <article className={`message ${message.sender}`} key={message.id}>
              {message.sender === "ai" ? <div className="message-avatar">S</div> : null}
              <div>
                <div className="message-bubble">{message.content}</div>
                <div className="message-footer"><span className="message-meta">{message.sender === "ai" ? "Socratic tutor" : "Your reasoning"}</span>{message.sender === "ai" ? <button type="button" onClick={() => readTutorMessage(message)} aria-label={`${speakingMessageId === message.id ? "Stop reading" : "Read aloud"} tutor message`}>{speakingMessageId === message.id ? <VolumeX size={13} /> : <Volume2 size={13} />}{speakingMessageId === message.id ? "Stop" : "Read aloud"}</button> : null}</div>
              </div>
              {message.sender === "student" ? <div className="message-avatar">A</div> : null}
            </article>
          ))}
          {pending ? <article className="message"><div className="message-avatar">S</div><div><div className="message-bubble thinking"><i /><i /><i /></div><span className="message-meta">Examining your reasoning</span></div></article> : null}
          <div ref={bottomRef} />
        </div>
        {session.pausedAt ? <div className="paused-session-card"><PauseCircle size={28} /><span className="section-kicker">Session paused</span><h2>Your progress is safely saved</h2><p>Resume when you are ready to continue from this exact phase and conversation.</p><button type="button" className="primary-button" onClick={resumeSession} disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Resume session</button>{error ? <div className="error-banner" role="alert">{error}</div> : null}</div> : <form className="chat-composer" onSubmit={submit}>
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
            <div className="composer-actions"><div className="composer-help"><small>Enter to send · Shift + Enter for a new line</small><small>Voice uses your browser&apos;s speech service. Do not include patient identifiers.</small></div><div className="composer-buttons"><button className={`voice-input-button${listening ? " listening" : ""}`} type="button" onClick={toggleSpeechInput} disabled={pending || !speechInputAvailable} aria-pressed={listening} aria-label={listening ? "Stop voice input" : "Start voice input"} title={speechInputAvailable ? "Dictate your answer" : "Voice input is not supported by this browser"}>{listening ? <MicOff size={17} /> : <Mic size={17} />}</button><button className="send-button" disabled={!answer.trim() || pending} aria-label="Send answer"><ArrowUp size={18} /></button></div></div>
          </div>
        </form>}
      </section>

      <aside className="session-sidebar right" aria-label="Session progress">
        <span className="sidebar-label">Session progress</span>
        <div className="progress-orbit" style={{ "--progress": `${progress}%` } as React.CSSProperties}><div><strong>{progress}%</strong><small>Complete</small></div></div>
        <div className="phase-card"><span>Current goal</span><strong>{currentPhase.title}</strong><p>{currentPhase.goal}</p></div>
        <div className="session-control-stack">
          {session.pausedAt ? <button className="pause-session" onClick={resumeSession} disabled={pending}><Play size={16} /> Resume session</button> : <button className="pause-session" onClick={pauseSession} disabled={pending}><PauseCircle size={16} /> Pause &amp; return to cases</button>}
          <button className="end-session" onClick={endSession} disabled={pending}>End session &amp; view summary</button>
        </div>
      </aside>
      {mobileCaseOpen ? <div className="mobile-case-backdrop"><aside className="mobile-case-drawer" aria-label="Case details and attachments"><button className="mobile-case-close" type="button" onClick={() => setMobileCaseOpen(false)} aria-label="Close case details"><X size={18} /></button><span className="sidebar-label">Active case</span><h2>{clinicalCase.title}</h2><p>{clinicalCase.description}</p><ul className="goal-list" aria-label="Learning phases">{clinicalCase.phases.map((phase) => <li key={phase.id} className={phase.order < session.currentPhase ? "done" : phase.order === session.currentPhase ? "active" : ""}><span className="goal-number">{phase.order < session.currentPhase ? <Check size={11} /> : phase.order}</span><span>{phase.title}</span></li>)}</ul><CaseResources clinicalCase={clinicalCase} /></aside></div> : null}
    </div>
  );
}
