"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

const FALLBACK_ERROR = "Couldn't prepare the download. Please try again in a minute.";

function fileNameFrom(disposition: string | null) {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "socratic-pilot-data.zip";
}

/** Downloads one class's pilot data (Excel plus Word transcripts) as a zip. */
export function PilotExportButton({ classId, className = "secondary-button" }: { classId: string; className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/classes/${encodeURIComponent(classId)}/pilot-export`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? FALLBACK_ERROR);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(response.headers.get("Content-Disposition"));
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setLoading(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button type="button" className={className} disabled={loading} aria-busy={loading} onClick={() => void download()}>
        {loading ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
        {loading ? "Preparing download…" : "Download pilot data"}
      </button>
      {error ? <small role="alert" style={{ color: "#b3261e", maxWidth: 280, textAlign: "right" }}>{error}</small> : null}
    </span>
  );
}
