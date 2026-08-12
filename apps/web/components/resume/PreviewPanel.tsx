"use client";
import { useState } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { ArrowSquareOut, DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import { RESUME_TEMPLATES } from "@/lib/resume-templates";

export function PreviewPanel() {
  const resumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const pdfSignedUrl = useResumeStore((s) => s.pdfSignedUrl);
  const isDirty = useResumeStore((s) => s.isDirty);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const { sessionId, pendingContent } = useTailoringStore();
  const isTailoringMode = pendingContent !== null;
  const router = useRouter();

  // Switch template and immediately re-render the preview if one exists.
  async function handleTemplateChange(id: string) {
    setTemplateId(id);
    if (!resumeId || !pdfSignedUrl) return; // no preview yet — user must click Generate PDF
    setIsGenerating(true);
    setGenError(null);
    try {
      const { signed_url } = await apiClient.generatePdf(resumeId, id);
      setPdfSignedUrl(signed_url);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Re-render failed");
    } finally {
      setIsGenerating(false);
    }
  }

  // Generate preview and update the iframe.
  async function handleGeneratePdf() {
    if (!resumeId) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      const { signed_url } = await apiClient.generatePdf(resumeId, templateId);
      setPdfSignedUrl(signed_url);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls Bar */}
      <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/20 flex-shrink-0 bg-surface-container-lowest flex-wrap gap-sm">
        {/* Template Switcher — dropdown in tailoring mode, pills otherwise */}
        {isTailoringMode ? (
          <div className="flex items-center gap-sm">
            <span className="text-label-sm text-on-surface-variant">Template:</span>
            <select
              value={templateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={isGenerating}
              className="px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface text-label-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all disabled:opacity-60 cursor-pointer"
            >
              {RESUME_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-xs flex-wrap">
            {RESUME_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTemplateChange(t.id)}
                disabled={isGenerating}
                className={`px-sm py-xs rounded-lg text-label-sm transition-colors disabled:opacity-60 ${
                  templateId === t.id
                    ? "bg-secondary-container text-primary font-bold"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-sm">
          {isDirty && (
            <span className="text-label-sm text-on-surface-variant italic">
              Saving…
            </span>
          )}
          {genError && (
            <span className="text-label-sm text-error">{genError}</span>
          )}
          {/* Hide Generate PDF in tailoring mode — the BulletReviewPanel owns that flow */}
          {!isTailoringMode && (
            <button
              onClick={handleGeneratePdf}
              disabled={!resumeId || isGenerating}
              className="flex items-center gap-xs px-md py-sm rounded-lg text-label-sm text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating
                ? <SpinnerGap size={16} className="animate-spin" />
                : <DownloadSimple size={16} />}
              {isGenerating ? "Generating…" : "Generate PDF"}
            </button>
          )}
          {sessionId && (
            <button
              onClick={() => router.push(`/interview/${sessionId}`)}
              className="flex items-center gap-xs px-md py-sm rounded-lg text-label-sm text-on-primary bg-primary hover:bg-primary-container transition-colors"
            >
              <ArrowSquareOut size={16} />
              Interview Prep
            </button>
          )}
        </div>
      </div>

      {/* PDF Preview Area */}
      <div className="flex-1 bg-surface-container overflow-y-auto relative">
        <div className="relative z-10 flex justify-center items-start p-md min-h-full">
          {pdfSignedUrl ? (
            <iframe
              src={pdfSignedUrl}
              className="w-full rounded-xl border border-outline-variant/20 shadow-xl bg-white"
              style={{ aspectRatio: "1 / 1.414", minHeight: "800px" }}
              title="Resume Preview"
            />
          ) : (
            <div className="w-full rounded-xl border-2 border-dashed border-outline-variant/50 flex items-center justify-center bg-white/70"
              style={{ aspectRatio: "1 / 1.414", minHeight: "800px" }}
            >
              <div className="text-center px-lg">
                <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center mx-auto mb-md">
                  <DownloadSimple size={32} className="text-on-surface-variant" />
                </div>
                <p className="text-on-surface text-body-md font-bold mb-sm">No PDF generated yet</p>
                <p className="text-on-surface-variant text-body-sm">
                  Click &ldquo;Generate PDF&rdquo; to preview your resume,
                  <br />or use &ldquo;Tailor to JD&rdquo; to optimize and generate.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
