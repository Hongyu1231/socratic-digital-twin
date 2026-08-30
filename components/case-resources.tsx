"use client";

import Image from "next/image";
import { AudioLines, ExternalLink, FileImage, Minus, Pause, Play, Plus, RotateCcw, Video, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CaseAttachment, ClinicalCase } from "@/lib/domain";

const subscribeToBrowserCapability = () => () => undefined;

export function CaseResources({ clinicalCase }: { clinicalCase: ClinicalCase }) {
  const headingId = useId();
  const dialogHeadingId = useId();
  const dialogDescriptionId = useId();
  const attachments = clinicalCase.attachments ?? [];
  const [preview, setPreview] = useState<CaseAttachment | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageStatus, setImageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imageRetry, setImageRetry] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const imageDragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const speechAvailable = useSyncExternalStore(
    subscribeToBrowserCapability,
    () => "speechSynthesis" in window,
    () => false,
  );

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const closePreview = useCallback(() => setPreview(null), []);

  function openPreview(attachment: CaseAttachment, trigger: HTMLButtonElement) {
    previewTriggerRef.current = trigger;
    setImageZoom(1);
    setImageStatus("loading");
    setImageRetry(0);
    setPreview(attachment);
  }

  function retryImage() {
    setImageStatus("loading");
    setImageRetry((retry) => retry + 1);
  }

  function changeImageZoom(nextZoom: number) {
    setImageZoom(Math.min(3, Math.max(0.75, nextZoom)));
  }

  function beginImagePan(event: React.PointerEvent<HTMLDivElement>) {
    const stage = imageStageRef.current;
    if (!stage || imageZoom <= 1) return;
    imageDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    stage.setPointerCapture(event.pointerId);
  }

  function panImage(event: React.PointerEvent<HTMLDivElement>) {
    const stage = imageStageRef.current;
    const drag = imageDragRef.current;
    if (!stage || !drag || drag.pointerId !== event.pointerId) return;
    stage.scrollLeft = drag.left - (event.clientX - drag.x);
    stage.scrollTop = drag.top - (event.clientY - drag.y);
  }

  function endImagePan(event: React.PointerEvent<HTMLDivElement>) {
    if (imageDragRef.current?.pointerId !== event.pointerId) return;
    imageDragRef.current = null;
    const stage = imageStageRef.current;
    if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    if (!preview) return;

    const previousBodyOverflow = document.body.style.overflow;
    const trigger = previewTriggerRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), audio[controls], video[controls], [tabindex]:not([tabindex='-1'])",
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function keepFocusInDialog(event: FocusEvent) {
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        closeButtonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);
    document.addEventListener("focusin", keepFocusInDialog);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.removeEventListener("focusin", keepFocusInDialog);
      document.body.style.overflow = previousBodyOverflow;
      queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, [closePreview, preview]);

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
      {attachments.length ? <div className="resource-list">
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
              onClick={(event) => {
                if (canPreview) {
                  openPreview(attachment, event.currentTarget);
                } else if (attachment.kind === "audio") {
                  toggleNarration(attachment);
                }
              }}
              disabled={attachment.kind === "audio" ? !hasAudioFile && (!speechAvailable || !attachment.transcript) : !canPreview}
              aria-label={`${actionLabel} ${attachment.title}`}
            >
              <Icon size={15} />
              <span><strong>{attachment.title}</strong><small>{attachment.description}</small></span>
              {canPreview ? <ExternalLink size={14} /> : playingId === attachment.id ? <Pause size={14} /> : <Play size={14} />}
            </button>
          );
        })}
      </div> : (
        <p className="resource-empty" role="status">
          No case-specific teaching media is attached yet. Ask your instructor before beginning an image-dependent script.
        </p>
      )}
      <small className="resource-disclaimer">Synthetic teaching materials only. Do not upload or infer real patient information.</small>

      {preview ? createPortal(
        <div className="media-dialog-backdrop">
          <button className="media-dialog-dismiss" type="button" tabIndex={-1} onClick={closePreview} aria-label="Close attachment preview" />
          <div ref={dialogRef} className="media-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogHeadingId} aria-describedby={dialogDescriptionId}>
            <div className="media-dialog-heading"><div><span className="section-kicker">Teaching attachment</span><h2 id={dialogHeadingId}>{preview.title}</h2></div><button ref={closeButtonRef} type="button" onClick={closePreview} aria-label="Close attachment"><X size={18} /></button></div>
            {preview.kind === "image" && preview.url ? <>
              <div className="media-image-toolbar" aria-label="Image controls">
                <button type="button" onClick={() => changeImageZoom(imageZoom - 0.25)} disabled={imageZoom <= 0.75} aria-label="Zoom out"><Minus size={15} /></button>
                <output aria-live="polite">{Math.round(imageZoom * 100)}%</output>
                <button type="button" onClick={() => changeImageZoom(imageZoom + 0.25)} disabled={imageZoom >= 3} aria-label="Zoom in"><Plus size={15} /></button>
                <button type="button" onClick={() => changeImageZoom(1)} disabled={imageZoom === 1} aria-label="Reset zoom"><RotateCcw size={15} /> Reset</button>
              </div>
              <div
                ref={imageStageRef}
                className="media-image-stage"
                data-pannable={imageZoom > 1}
                tabIndex={imageZoom > 1 ? 0 : -1}
                role="region"
                aria-label="Zoomable teaching image"
                onPointerDown={beginImagePan}
                onPointerMove={panImage}
                onPointerUp={endImagePan}
                onPointerCancel={endImagePan}
              >
                {imageStatus === "loading" ? <span className="media-image-loading" role="status">Loading teaching image…</span> : null}
                {imageStatus === "error" ? <div className="media-image-error" role="alert"><strong>Teaching image could not be loaded.</strong><button type="button" onClick={retryImage}>Try again</button></div> : null}
                {preview.url.startsWith("https://") ? (
                  // Literature images may come from a validated external HTTPS
                  // source that is not known at build time, so Next Image's fixed
                  // remote-host allowlist cannot be used for this authoring path.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={imageRetry} src={preview.url} alt={preview.description} draggable={false} loading="lazy" referrerPolicy="no-referrer" style={{ width: `${imageZoom * 100}%` }} onLoad={() => setImageStatus("ready")} onError={() => setImageStatus("error")} />
                ) : <Image key={imageRetry} src={preview.url} alt={preview.description} draggable={false} width={1200} height={760} style={{ width: `${imageZoom * 100}%` }} onLoad={() => setImageStatus("ready")} onError={() => setImageStatus("error")} />}
              </div>
            </> : null}
            {preview.kind === "video" && preview.url ? <video src={preview.url} poster={preview.posterUrl} controls playsInline><track kind="captions" src="/media/english-captions.vtt" srcLang="en" label="English" default /></video> : null}
            {preview.kind === "audio" && preview.url ? <audio src={preview.url} controls><track kind="captions" /></audio> : null}
            <p id={dialogDescriptionId}>{preview.description}</p>
            {preview.sourceLabel ? <p className="resource-source">Source: {preview.sourceUrl ? <a href={preview.sourceUrl} target="_blank" rel="noreferrer">{preview.sourceLabel}</a> : preview.sourceLabel}</p> : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
