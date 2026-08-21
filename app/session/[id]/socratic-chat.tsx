"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowUp, BookOpen, Check, Info, LoaderCircle, Mic, MicOff, PauseCircle, Play, RotateCw, Volume2, VolumeX, X } from "lucide-react";
import type { SessionBundle, TutorMessage } from "@/lib/domain";
import { CaseResources } from "@/components/case-resources";
import { selectPreferredEnglishVoice } from "@/lib/speech";
import { describeRequestFailure, readJsonBody, requestSignal } from "@/lib/client-request";

// Ending a session commits a deterministic summary immediately. Keep a
// deadline for network/server failures while optional model enhancement runs
// asynchronously after completion.
const END_SESSION_TIMEOUT_MS = 45_000;
const SLOW_NOTICE_MS = 8_000;

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
type SessionPendingAction = "message" | "pause" | "resume" | "end";

export function SocraticChat({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<SessionPendingAction | null>(null);
  const pending = pendingAction !== null;
  const [optimisticMessage, setOptimisticMessage] = useState<TutorMessage | null>(null);
  const [listening, setListening] = useState(false);
  const [speechInputAvailable, setSpeechInputAvailable] = useState(false);
  const [speechOutputAvailable, setSpeechOutputAvailable] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [preparingVoiceMessageId, setPreparingVoiceMessageId] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(true);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [mobileCaseOpen, setMobileCaseOpen] = useState(false);
  const [endNotice, setEndNotice] = useState("");
  const [failedSend, setFailedSend] = useState<{ content: string; clientRequestId: string; error: string } | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speechRequestRef = useRef<AbortController | null>(null);
  const voiceBaseRef = useRef("");
  const lastAutoReadRef = useRef<string | null>(null);

  const stopTutorSpeech = useCallback(() => {
    speechRequestRef.current?.abort();
    speechRequestRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    setSpeakingMessageId(null);
    setPreparingVoiceMessageId(null);
  }, []);

  useEffect(() => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    setSpeechInputAvailable(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    const browserSpeechSupported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    const speechOutputSupported = typeof Audio !== "undefined" || browserSpeechSupported;
    setSpeechOutputAvailable(speechOutputSupported);
    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis?.getVoices() ?? [];
    };
    if (browserSpeechSupported) {
      loadVoices();
      window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    }
    return () => {
      recognitionRef.current?.abort();
      speechRequestRef.current?.abort();
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      window.speechSynthesis?.cancel();
      if (browserSpeechSupported) window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  const speakWithBrowserVoice = useCallback((message: TutorMessage) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setPreparingVoiceMessageId(null);
      setVoiceNotice("Tutor audio is unavailable right now. You can still read every reply on screen.");
      return false;
    }

    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    synthesis.resume();

    const utterance = new SpeechSynthesisUtterance(message.content);
    const preferredVoice = selectPreferredEnglishVoice(voicesRef.current);
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.lang = preferredVoice?.lang ?? "en-GB";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utteranceRef.current = utterance;

    const finish = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeakingMessageId(null);
    };
    utterance.onstart = () => {
      setPreparingVoiceMessageId(null);
      setVoiceNotice("");
      setSpeakingMessageId(message.id);
    };
    utterance.onend = finish;
    utterance.onerror = (event) => {
      setPreparingVoiceMessageId(null);
      finish();
      setVoiceNotice(event.error === "not-allowed"
        ? "Your browser blocked automatic audio. Click Read aloud to start the AI-generated voice."
        : "Tutor audio could not play. You can retry with Read aloud.");
    };

    setSpeakingMessageId(message.id);
    synthesis.speak(utterance);
    return true;
  }, []);

  const speakTutorMessage = useCallback(async (message: TutorMessage) => {
    stopTutorSpeech();
    setSpeakingMessageId(message.id);
    setPreparingVoiceMessageId(message.id);
    setVoiceNotice("");

    const controller = new AbortController();
    speechRequestRef.current = controller;
    try {
      const response = await fetch("/api/session/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messageId: message.id }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Server tutor voice is unavailable.");
      const audioBlob = await response.blob();
      if (controller.signal.aborted) return false;

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audioUrlRef.current = audioUrl;
      audioRef.current = audio;
      speechRequestRef.current = null;
      audio.onplaying = () => {
        setPreparingVoiceMessageId(null);
        setVoiceNotice("");
      };
      audio.onended = () => {
        if (audioRef.current !== audio) return;
        audioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        audioUrlRef.current = null;
        setSpeakingMessageId(null);
      };
      audio.onerror = () => {
        if (audioRef.current !== audio) return;
        audioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        audioUrlRef.current = null;
        setSpeakingMessageId(null);
        setPreparingVoiceMessageId(null);
        setVoiceNotice("Tutor audio could not play. Click Read aloud to retry.");
      };
      await audio.play();
      return true;
    } catch {
      if (controller.signal.aborted) return false;
      speechRequestRef.current = null;
      return speakWithBrowserVoice(message);
    }
  }, [sessionId, speakWithBrowserVoice, stopTutorSpeech]);

  useEffect(() => {
    // Warm the summary route so ending the session does not stall on a cold
    // client-side transition.
    router.prefetch(`/session/${sessionId}/summary`);
    fetch(`/api/session/${sessionId}`)
      .then(async (response) => {
        const data = await readJsonBody<SessionBundle & { error?: string }>(response, "Session could not be loaded.");
        if (!response.ok) throw new Error(data.error ?? "Session could not be loaded.");
        return data;
      })
      .then((data) => {
        setBundle(data);
        if (data.session.status === "completed") router.replace(`/session/${sessionId}/summary`);
      })
      .catch((reason) => setError(describeRequestFailure(reason, "Session could not be loaded.", "The session is taking longer than expected to load.")));
  }, [router, sessionId]);

  useEffect(() => {
    const list = messageListRef.current;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // On the desktop layout the list is its own scroll container; on the narrow
    // layout the document scrolls instead, so fall back to the end sentinel.
    if (list && list.scrollHeight > list.clientHeight) {
      list.scrollTo({ top: list.scrollHeight, behavior });
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, [bundle?.session.messages.length, optimisticMessage?.id, failedSend, pending]);

  useEffect(() => {
    if (!autoRead || pending || !bundle || !speechOutputAvailable) return;
    const latestTutorMessage = [...bundle.session.messages].reverse().find((message) => message.sender === "ai");
    if (!latestTutorMessage || latestTutorMessage.id === lastAutoReadRef.current) return;
    lastAutoReadRef.current = latestTutorMessage.id;
    void speakTutorMessage(latestTutorMessage);
  }, [autoRead, bundle, pending, speakTutorMessage, speechOutputAvailable]);

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
    if (speakingMessageId === message.id) {
      stopTutorSpeech();
      return;
    }
    void speakTutorMessage(message);
  }

  function toggleTutorVoice() {
    const nextAutoRead = !autoRead;
    setAutoRead(nextAutoRead);
    setVoiceNotice("");
    if (!nextAutoRead) {
      stopTutorSpeech();
      return;
    }

    window.speechSynthesis?.resume();
    const latestTutorMessage = bundle
      ? [...bundle.session.messages].reverse().find((message) => message.sender === "ai")
      : undefined;
    if (latestTutorMessage) {
      lastAutoReadRef.current = latestTutorMessage.id;
      void speakTutorMessage(latestTutorMessage);
    }
  }

  async function sendMessage(message: string, clientRequestId: string) {
    if (pending) return;

    // Resume speech from the student's click/keypress so browsers that suspend
    // synthesis while a tab is idle can play the asynchronous tutor reply.
    if (autoRead && speechOutputAvailable) window.speechSynthesis?.resume();

    setError("");
    setFailedSend(null);
    setOptimisticMessage({
      id: `optimistic-${clientRequestId}`,
      sessionId,
      sender: "student",
      content: message,
      timestamp: new Date().toISOString(),
    });
    setPendingAction("message");

    try {
      const response = await fetch("/api/session/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message, clientRequestId }),
      });
      const data = await readJsonBody<SessionBundle & { error?: string }>(response, "Your answer could not be evaluated.");
      if (!response.ok) {
        throw new Error(data.error ?? "Your answer could not be evaluated.");
      }
      setBundle(data);
      if (data.session.status === "completed") router.push(`/session/${sessionId}/summary`);
    } catch (reason) {
      // Keep the answer in the transcript as a failed message. It used to be
      // removed and reported only in the composer, which sits below the fold.
      setFailedSend({
        content: message,
        clientRequestId,
        error: describeRequestFailure(reason, "Your answer could not be evaluated.", "The tutor did not reply in time."),
      });
    } finally {
      setOptimisticMessage(null);
      setPendingAction(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = answer.trim();
    if (!message || pending) return;
    setAnswer("");
    // The same id on a retry lets the server treat it as one attempt.
    void sendMessage(message, crypto.randomUUID());
  }

  async function endSession() {
    if (!window.confirm("End this session now? Your summary will reflect the phases completed so far.")) return;
    setPendingAction("end");
    setError("");
    const slowNotice = setTimeout(() => setEndNotice("Saving your summary. The immediate version is ready; this request is taking longer than expected."), SLOW_NOTICE_MS);
    try {
      const response = await fetch(`/api/session/${sessionId}/complete`, { method: "POST", signal: requestSignal(END_SESSION_TIMEOUT_MS) });
      const data = await readJsonBody<{ error?: string }>(response, "The session could not be ended.");
      if (!response.ok) throw new Error(data.error ?? "The session could not be ended.");
      router.push(`/session/${sessionId}/summary`);
    } catch (reason) {
      setError(describeRequestFailure(reason, "The session could not be ended.", "Saving the completed session is taking longer than expected. Your progress may already be saved — please check the summary and try again if needed."));
      setEndNotice("");
      setPendingAction(null);
    } finally {
      clearTimeout(slowNotice);
    }
  }

  async function pauseSession() {
    if (pending) return;
    setPendingAction("pause");
    setError("");
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
    try {
      const response = await fetch(`/api/session/${sessionId}/pause`, { method: "POST" });
      const data = await readJsonBody<{ error?: string }>(response, "The session could not be paused.");
      if (!response.ok) throw new Error(data.error ?? "The session could not be paused.");
      router.push("/");
    } catch (reason) {
      setError(describeRequestFailure(reason, "The session could not be paused.", "Pausing is taking longer than expected. Please try again."));
      setPendingAction(null);
    }
  }

  async function resumeSession() {
    setPendingAction("resume");
    setError("");
    try {
      const response = await fetch(`/api/session/${sessionId}/resume`, { method: "POST" });
      const data = await readJsonBody<SessionBundle & { error?: string }>(response, "The session could not be resumed.");
      if (!response.ok) throw new Error(data.error ?? "The session could not be resumed.");
      setBundle(data);
    } catch (reason) {
      setError(describeRequestFailure(reason, "The session could not be resumed.", "Resuming is taking longer than expected. Please try again."));
    } finally {
      setPendingAction(null);
    }
  }

  if (!bundle) {
    return <div className="empty-state"><LoaderCircle className="spin" /><h2>Preparing your reasoning space…</h2><p>{error || "Retrieving the case and learner state."}</p></div>;
  }

  const { session, case: clinicalCase } = bundle;
  const currentPhase = clinicalCase.phases.find((phase) => phase.order === session.currentPhase)!;
  // The current phase is in progress, not finished: the phase checklist below
  // marks a phase done only once currentPhase has moved past it.
  const completedPhases = session.status === "completed" ? clinicalCase.phases.length : session.currentPhase - 1;
  const progress = Math.round((completedPhases / clinicalCase.phases.length) * 100);
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
            <button className="mobile-pause-button" type="button" onClick={pauseSession} disabled={pending || Boolean(session.pausedAt)}>{pendingAction === "pause" ? <LoaderCircle className="spin" size={14} /> : <PauseCircle size={14} />}<span>{pendingAction === "pause" ? "Pausing…" : "Pause"}</span></button>
            <button className="mobile-end-button" type="button" onClick={endSession} disabled={pending}>{pendingAction === "end" ? <><LoaderCircle className="spin" size={13} /> Ending…</> : "End"}</button>
            <button className="voice-toggle" type="button" aria-pressed={autoRead && speechOutputAvailable} onClick={toggleTutorVoice} disabled={!speechOutputAvailable} title={speechOutputAvailable ? "Turn automatic tutor voice replies on or off" : "Tutor voice is not supported by this browser"}>
              {autoRead && speechOutputAvailable ? <Volume2 size={14} /> : <VolumeX size={14} />} <span>{!speechOutputAvailable ? "Voice unavailable" : preparingVoiceMessageId ? "Preparing voice" : speakingMessageId ? "Tutor speaking" : autoRead ? "Tutor voice on" : "Tutor voice off"}</span>
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
        <div className="message-list" aria-live="polite" ref={messageListRef}>
          {voiceNotice ? <div className="voice-notice" role="status">{voiceNotice}</div> : null}
          {visibleMessages.map((message) => (
            <article className={`message ${message.sender}`} key={message.id}>
              {message.sender === "ai" ? <div className="message-avatar">S</div> : null}
              <div>
                <div className="message-bubble">
                  {message.content}
                  {preparingVoiceMessageId === message.id ? <span className="voice-inline-loading" role="status"><LoaderCircle className="spin" size={12} /> Preparing voice…</span> : null}
                </div>
                <div className="message-footer"><span className="message-meta">{message.sender === "ai" ? "Socratic tutor" : "Your reasoning"}</span>{message.sender === "ai" ? <button type="button" onClick={() => readTutorMessage(message)} aria-label={`${speakingMessageId === message.id ? "Stop reading" : "Read aloud"} tutor message`}>{speakingMessageId === message.id ? <VolumeX size={13} /> : <Volume2 size={13} />}{speakingMessageId === message.id ? "Stop" : "Read aloud"}</button> : null}</div>
              </div>
              {message.sender === "student" ? <div className="message-avatar">A</div> : null}
            </article>
          ))}
          {failedSend ? (
            <article className="message student failed">
              <div>
                <div className="message-bubble">{failedSend.content}</div>
                <div className="message-failure" role="alert">
                  <span><AlertCircle size={13} /> Not sent — {failedSend.error}</span>
                  <div>
                    <button type="button" disabled={pending} onClick={() => void sendMessage(failedSend.content, failedSend.clientRequestId)}><RotateCw size={12} /> Try again</button>
                    <button type="button" disabled={pending} onClick={() => { setAnswer(failedSend.content); setFailedSend(null); }}>Edit message</button>
                  </div>
                </div>
              </div>
              <div className="message-avatar">A</div>
            </article>
          ) : null}
          {pendingAction === "message" ? <article className="message"><div className="message-avatar">S</div><div><div className="message-bubble thinking"><i /><i /><i /></div><span className="message-meta">Examining your reasoning</span></div></article> : null}
          <div ref={bottomRef} />
        </div>
        {session.pausedAt ? <div className="paused-session-card"><PauseCircle size={28} /><span className="section-kicker">Session paused</span><h2>Your progress is safely saved</h2><p>Resume when you are ready to continue from this exact phase and conversation.</p><button type="button" className="primary-button" onClick={resumeSession} disabled={pending}>{pendingAction === "resume" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} {pendingAction === "resume" ? "Resuming…" : "Resume session"}</button>{error ? <div className="error-banner" role="alert">{error}</div> : null}</div> : <form className="chat-composer" onSubmit={submit}>
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
            <div className="composer-actions"><div className="composer-help"><small>Enter to send · Shift + Enter for a new line</small><small>Tutor audio is AI-generated. Do not include patient identifiers.</small></div><div className="composer-buttons"><button className={`voice-input-button${listening ? " listening" : ""}`} type="button" onClick={toggleSpeechInput} disabled={pending || !speechInputAvailable} aria-pressed={listening} aria-label={listening ? "Stop voice input" : "Start voice input"} title={speechInputAvailable ? "Dictate your answer" : "Voice input is not supported by this browser"}>{listening ? <MicOff size={17} /> : <Mic size={17} />}</button><button className="send-button" disabled={!answer.trim() || pending} aria-label={pendingAction === "message" ? "Sending answer" : "Send answer"}>{pendingAction === "message" ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={18} />}</button></div></div>
          </div>
        </form>}
      </section>

      <aside className="session-sidebar right" aria-label="Session progress">
        <span className="sidebar-label">Session progress</span>
        <div className="progress-orbit" style={{ "--progress": `${progress}%` } as React.CSSProperties}><div><strong>{progress}%</strong><small>Complete</small></div></div>
        <div className="phase-card"><span>Current goal</span><strong>{currentPhase.title}</strong><p>{currentPhase.goal}</p></div>
        <div className="session-control-stack">
          {session.pausedAt ? <button className="pause-session" onClick={resumeSession} disabled={pending}>{pendingAction === "resume" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} {pendingAction === "resume" ? "Resuming…" : "Resume session"}</button> : <button className="pause-session" onClick={pauseSession} disabled={pending}>{pendingAction === "pause" ? <LoaderCircle className="spin" size={16} /> : <PauseCircle size={16} />} {pendingAction === "pause" ? "Pausing…" : "Pause & return to cases"}</button>}
          <button className="end-session" onClick={endSession} disabled={pending}>{pendingAction === "end" ? <LoaderCircle className="spin" size={16} /> : null}{pendingAction === "end" ? "Ending session…" : "End session & view summary"}</button>
          {endNotice ? <p className="loading-notice" role="status">{endNotice}</p> : null}
        </div>
      </aside>
      {mobileCaseOpen ? <div className="mobile-case-backdrop"><aside className="mobile-case-drawer" aria-label="Case details and attachments"><button className="mobile-case-close" type="button" onClick={() => setMobileCaseOpen(false)} aria-label="Close case details"><X size={18} /></button><span className="sidebar-label">Active case</span><h2>{clinicalCase.title}</h2><p>{clinicalCase.description}</p><ul className="goal-list" aria-label="Learning phases">{clinicalCase.phases.map((phase) => <li key={phase.id} className={phase.order < session.currentPhase ? "done" : phase.order === session.currentPhase ? "active" : ""}><span className="goal-number">{phase.order < session.currentPhase ? <Check size={11} /> : phase.order}</span><span>{phase.title}</span></li>)}</ul><CaseResources clinicalCase={clinicalCase} /></aside></div> : null}
    </div>
  );
}
