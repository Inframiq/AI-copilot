"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowSquareOut, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";

interface Props {
  resumeId: string;
  templateId: string;
  title: string;
  onClose: () => void;
}

export function ResumePreviewModal({ resumeId, templateId, title, onClose }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    // Prefer the untouched file the user actually uploaded — Preview must
    // never show an AI-reparsed/re-templated stand-in for it. Only resumes
    // built from scratch in Studio (no upload) fall back to rendering
    // resume.content through a template, since that IS their real content.
    apiClient.getOriginalResumeFile(resumeId)
      .then(({ signed_url }) => { if (!cancelled) setPdfUrl(signed_url); })
      .catch(() => {
        apiClient.generatePdf(resumeId, templateId)
          .then(({ signed_url }) => { if (!cancelled) setPdfUrl(signed_url); })
          .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load preview"); });
      });
    return () => { cancelled = true; };
  }, [resumeId, templateId]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-lg pointer-events-none">
        <div className="pointer-events-auto w-full max-w-2xl max-h-[90vh] flex flex-col bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/20 shrink-0">
            <p className="text-label-md text-on-surface font-semibold truncate">{title}</p>
            <div className="flex items-center gap-sm shrink-0">
              <button
                onClick={() => router.push(`/studio/${resumeId}`)}
                className="flex items-center gap-xs px-md py-sm rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all"
              >
                <ArrowSquareOut size={14} /> Open in Builder
              </button>
              <button onClick={onClose} className="p-sm rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>
          {/* NOTE: this container must not center-align on the cross axis —
              centering a flex item taller than an overflow:auto ancestor
              clips its start, and the browser won't let you scroll back up
              to see it (a well-known flexbox+overflow trap). */}
          <div className="flex-1 bg-surface-container overflow-y-auto p-md">
            {error ? (
              <div className="flex flex-col items-center text-center px-lg py-xxl">
                <WarningCircle size={32} className="text-error mb-sm" />
                <p className="text-body-sm text-error">{error}</p>
              </div>
            ) : pdfUrl ? (
              <iframe
                src={pdfUrl}
                className="w-full rounded-xl border border-outline-variant/20 shadow-xl bg-white"
                style={{ aspectRatio: "1 / 1.414" }}
                title="Resume Preview"
              />
            ) : (
              <div className="flex flex-col items-center gap-sm py-xxl">
                <SpinnerGap size={28} className="text-primary animate-spin" />
                <p className="text-body-sm text-on-surface-variant">Generating preview…</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
