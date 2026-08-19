"use client";

import Image from "next/image";
import { AudioLines, ExternalLink, FileImage, Pause, Play, Video, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import type { CaseAttachment, ClinicalCase } from "@/lib/domain";

const subscribeToBrowserCapability = () => () => undefined;

function defaultAttachments(clinicalCase: ClinicalCase): CaseAttachment[] {
  return [
    {
      id: `${clinicalCase.id}-observation-guide`,
      kind: "image",
      title: "Clinical observation guide",
      description: "A non-diagnostic visual framework for organizing case evidence.",
      url: "/media/clinical-observation-guide.svg",
    },
    {
      id: `${clinicalCase.id}-history-audio`,
      kind: "audio",
      title: "Patient history narration",
      description: "Listen to the simulated presenting history.",
      transcript: clinicalCase.description,
    },
  ];
}

export function CaseResources({ clinicalCase }: { clinicalCase: ClinicalCase }) {
  const headingId = useId();
  const attachments = useMemo(
    () => clinicalCase.attachments?.length ? clinicalCase.attachments : defaultAttachments(clinicalCase),
    [clinicalCase],
  );
  const [preview, setPreview] = useState<CaseAttachment | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const speechAvailable = useSyncExternalStore(
    subscribeToBrowserCapability,
    () => "speechSynthesis" in window,
    () => false,
  );

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  function toggleNarration(attachment: CaseAttachment) {
    if (!speechAvailable || !attachment.transcript) return;
    if (playingId === attachment.id) {
      window.speechSynthesis.cancel();
      setPlayingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(attachment.transcript);
    utterance.lang = "en-SG";
    utterance.rate = 0.95;
    utterance.onend = () => setPlayingId(null);
    utterance.onerror = () => setPlayingId(null);
    setPlayingId(attachment.id);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className="case-resources" aria-labelledby={headingId}>
      <span className="sidebar-label" id={headingId}>Case attachments</span>
      <div className="resource-list">
        {attachments.map((attachment) => {
          const Icon = attachment.kind === "image" ? FileImage : attachment.kind === "video" ? Video : AudioLines;
          const hasAudioFile = attachment.kind === "audio" && Boolean(attachment.url);
          const canPreview = Boolean(attachment.url) && (attachment.kind !== "audio" || hasAudioFile);
          const actionLabel = canPreview ? "Open" : playingId === attachment.id ? "Pause" : "Play";
          return (
            <button
              className="resource-button"
              type="button"
              key={attachment.id}
              onClick={() => canPreview ? setPreview(attachment) : attachment.kind === "audio" ? toggleNarration(attachment) : undefined}
              disabled={attachment.kind === "audio" ? !hasAudioFile && (!speechAvailable || !attachment.transcript) : !canPreview}
              aria-label={`${actionLabel} ${attachment.title}`}
            >
              <Icon size={15} />
              <span><strong>{attachment.title}</strong><small>{attachment.description}</small></span>
              {canPreview ? <ExternalLink size={14} /> : playingId === attachment.id ? <Pause size={14} /> : <Play size={14} />}
            </button>
          );
        })}
      </div>
      <small className="resource-disclaimer">Synthetic teaching materials only. Do not upload or infer real patient information.</small>

      {preview ? (
        <div className="media-dialog-backdrop">
          <div className="media-dialog" role="dialog" aria-modal="true" aria-labelledby="media-dialog-title">
            <div className="media-dialog-heading"><div><span className="section-kicker">Teaching attachment</span><h2 id="media-dialog-title">{preview.title}</h2></div><button type="button" onClick={() => setPreview(null)} aria-label="Close attachment"><X size={18} /></button></div>
            {preview.kind === "image" && preview.url ? preview.url.startsWith("https://") ? (
              // Literature images may come from a validated external HTTPS
              // source that is not known at build time, so Next Image's fixed
              // remote-host allowlist cannot be used for this authoring path.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.description} loading="lazy" referrerPolicy="no-referrer" />
            ) : <Image src={preview.url} alt={preview.description} width={1200} height={760} /> : null}
            {preview.kind === "video" && preview.url ? <video src={preview.url} poster={preview.posterUrl} controls playsInline><track kind="captions" src="/media/english-captions.vtt" srcLang="en" label="English" default /></video> : null}
            {preview.kind === "audio" && preview.url ? <audio src={preview.url} controls><track kind="captions" /></audio> : null}
            <p>{preview.description}</p>
            {preview.sourceLabel ? <p className="resource-source">Source: {preview.sourceUrl ? <a href={preview.sourceUrl} target="_blank" rel="noreferrer">{preview.sourceLabel}</a> : preview.sourceLabel}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
