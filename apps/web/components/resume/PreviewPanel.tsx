"use client";
import { useState } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { ArrowSquareOut, ArrowsClockwise, DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import { RESUME_TEMPLATES } from "@/lib/resume-templates";

// Real resume-formatting guidance (Teal, WashU Career Engagement, Hireflow —
// see the commit that introduced this) converges on: 1.0-1.15 line spacing
// within bullets/body text, 8-12pt after each section, and section-to-
// section separation running 1.5-2x that. These three presets are single
// values within (Compact, Standard) or just past (Spacious) that range,
// snapped to the sliders' step sizes (0.05 / 2px) so picking one lands
// exactly on a reachable slider position, not an in-between value the
// slider itself could never produce.
const SPACING_PRESETS = [
  { label: "Compact", lineSpacing: 1.0, paragraphSpacing: 8 },
  { label: "Standard", lineSpacing: 1.15, paragraphSpacing: 12 },
  { label: "Spacious", lineSpacing: 1.4, paragraphSpacing: 18 },
] as const;

export function PreviewPanel() {
  const resumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const lineSpacing = useResumeStore((s) => s.lineSpacing);
  const paragraphSpacing = useResumeStore((s) => s.paragraphSpacing);
  const pdfSignedUrl = useResumeStore((s) => s.pdfSignedUrl);
  const isDirty = useResumeStore((s) => s.isDirty);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const setSpacing = useResumeStore((s) => s.setSpacing);
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // Spacing sliders only mark the preview stale — regenerating on every drag
  // tick would fire a WeasyPrint render per pixel of slider movement.
  const [spacingStale, setSpacingStale] = useState(false);

  const { sessionId, pendingContent, generatePreview } = useTailoringStore();
  const isTailoringMode = pendingContent !== null;
  const router = useRouter();

  // Switch template and immediately re-render the preview if one exists.
  async function handleTemplateChange(id: string) {
    setTemplateId(id);
    if (!resumeId || !pdfSignedUrl) return; // no preview yet — user must click Generate PDF
    setIsGenerating(true);
    setGenError(null);
    try {
      const { signed_url } = await apiClient.generatePdf(resumeId, id, undefined, lineSpacing, paragraphSpacing);
      setPdfSignedUrl(signed_url);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Re-render failed");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleSpacingChange(nextLineSpacing: number, nextParagraphSpacing: number) {
    setSpacing(nextLineSpacing, nextParagraphSpacing);
    if (pdfSignedUrl) setSpacingStale(true);
  }

  // Generate preview and update the iframe.
  async function handleGeneratePdf() {
    if (!resumeId) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      const { signed_url } = await apiClient.generatePdf(resumeId, templateId, undefined, lineSpacing, paragraphSpacing);
      setPdfSignedUrl(signed_url);
      setSpacingStale(false);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  // Tailoring mode's first preview is owned by BulletReviewPanel (it needs
  // the merged accept/reject/humanize state, not just the saved resume), but
  // once that preview exists, re-rendering it for a spacing change only
  // needs generatePreview() re-run — same merged content, new spacing.
  async function handleRegenerateTailoredPreview() {
    if (!resumeId) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      await generatePreview(resumeId);
      setSpacingStale(false);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Regeneration failed");
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

        {/* Spacing controls — only relevant once a preview actually exists;
            before that there's nothing rendered yet for them to affect.
            Shown in both modes (previously hidden whenever isTailoringMode
            was true, even after a tailored preview had already rendered —
            backwards: gone exactly when they'd have something to adjust). */}
        {pdfSignedUrl && (
          <div className="flex items-center gap-md flex-wrap">
            <div className="flex items-center gap-xs">
              <label htmlFor="spacing-preset" className="text-label-sm text-on-surface-variant whitespace-nowrap">
                Spacing
              </label>
              <select
                id="spacing-preset"
                value={
                  SPACING_PRESETS.find(
                    (p) => p.lineSpacing === lineSpacing && p.paragraphSpacing === paragraphSpacing
                  )?.label ?? "Custom"
                }
                onChange={(e) => {
                  const preset = SPACING_PRESETS.find((p) => p.label === e.target.value);
                  if (preset) handleSpacingChange(preset.lineSpacing, preset.paragraphSpacing);
                }}
                className="px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface text-label-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
              >
                {!SPACING_PRESETS.some(
                  (p) => p.lineSpacing === lineSpacing && p.paragraphSpacing === paragraphSpacing
                ) && <option value="Custom">Custom</option>}
                {SPACING_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-xs">
              <label htmlFor="line-spacing" className="text-label-sm text-on-surface-variant whitespace-nowrap">
                Line spacing
              </label>
              <input
                id="line-spacing"
                type="range"
                min={1}
                max={1.6}
                step={0.05}
                value={lineSpacing}
                onChange={(e) => handleSpacingChange(parseFloat(e.target.value), paragraphSpacing)}
                className="w-20 accent-primary"
              />
              <span className="text-label-sm text-on-surface-variant w-9 text-right">{lineSpacing.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-xs">
              <label htmlFor="paragraph-spacing" className="text-label-sm text-on-surface-variant whitespace-nowrap">
                Paragraph spacing
              </label>
              <input
                id="paragraph-spacing"
                type="range"
                min={0}
                max={24}
                step={2}
                value={paragraphSpacing}
                onChange={(e) => handleSpacingChange(lineSpacing, parseInt(e.target.value, 10))}
                className="w-20 accent-primary"
              />
              <span className="text-label-sm text-on-surface-variant w-9 text-right">{paragraphSpacing}px</span>
            </div>
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
              className={`flex items-center gap-xs px-md py-sm rounded-lg text-label-sm border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                spacingStale
                  ? "text-on-primary bg-primary border-primary hover:bg-primary-container"
                  : "text-on-surface-variant border-outline-variant hover:bg-surface-container-low"
              }`}
            >
              {isGenerating ? (
                <SpinnerGap size={16} className="animate-spin" />
              ) : spacingStale ? (
                <ArrowsClockwise size={16} />
              ) : (
                <DownloadSimple size={16} />
              )}
              {isGenerating ? "Generating…" : spacingStale ? "Regenerate PDF" : "Generate PDF"}
            </button>
          )}
          {/* Tailoring mode's equivalent — BulletReviewPanel owns the first
              preview render (it needs the merged bullet decisions), but once
              that preview exists, a spacing change only needs generatePreview
              re-run, not the full accept/reject flow again. */}
          {isTailoringMode && pdfSignedUrl && (
            <button
              onClick={handleRegenerateTailoredPreview}
              disabled={isGenerating}
              className={`flex items-center gap-xs px-md py-sm rounded-lg text-label-sm border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                spacingStale
                  ? "text-on-primary bg-primary border-primary hover:bg-primary-container"
                  : "text-on-surface-variant border-outline-variant hover:bg-surface-container-low"
              }`}
            >
              {isGenerating ? (
                <SpinnerGap size={16} className="animate-spin" />
              ) : spacingStale ? (
                <ArrowsClockwise size={16} />
              ) : (
                <DownloadSimple size={16} />
              )}
              {isGenerating ? "Generating…" : spacingStale ? "Regenerate Preview" : "Preview Up To Date"}
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
