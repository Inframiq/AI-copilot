"use client";
import { useEffect, useState } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { ArrowSquareOut, ArrowsClockwise, FileText, SpinnerGap } from "@phosphor-icons/react";

// Hides the embedded PDF viewer's own toolbar (its download/print bar) so
// the header's "Download PDF" stays the one place to actually download —
// works on both signed https URLs and the data: URIs generatePdf() returns.
function withHiddenToolbar(url: string): string {
  return url.includes("#") ? url : `${url}#toolbar=0`;
}

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

// Every stack ends in a bare generic (sans-serif/serif) deliberately — must
// match FONT_STACKS in apps/api/app/services/pdf.py exactly, both in keys
// and in which generic each ends with (the render host has no font packages
// installed, so only the trailing generic keyword is guaranteed to resolve).
const FONT_CHOICES = [
  { value: "sans", label: "Sans" },
  { value: "modern_sans", label: "Modern Sans" },
  { value: "serif", label: "Serif" },
  { value: "classic_serif", label: "Classic Serif" },
] as const;

// Mirrors TEMPLATE_DEFAULT_ACCENT in apps/api/app/services/pdf.py — only
// used so the color picker shows the template's actual current accent
// instead of an arbitrary color when the user hasn't overridden it yet.
const TEMPLATE_DEFAULT_ACCENT: Record<string, string> = {
  ats_clean: "#111111",
  ats_modern: "#5c6bc0",
  ats_sidebar: "#4c6178",
  ats_professional: "#1f5fbf",
  ats_minimal: "#1a1a1a",
};

export function PreviewPanel() {
  const resumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const lineSpacing = useResumeStore((s) => s.lineSpacing);
  const paragraphSpacing = useResumeStore((s) => s.paragraphSpacing);
  const fontChoice = useResumeStore((s) => s.fontChoice);
  const accentColor = useResumeStore((s) => s.accentColor);
  const pdfSignedUrl = useResumeStore((s) => s.pdfSignedUrl);
  const isDirty = useResumeStore((s) => s.isDirty);
  const setSpacing = useResumeStore((s) => s.setSpacing);
  const setFontChoice = useResumeStore((s) => s.setFontChoice);
  const setAccentColor = useResumeStore((s) => s.setAccentColor);
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // Spacing sliders only mark the preview stale — regenerating on every drag
  // tick would fire a WeasyPrint render per pixel of slider movement.
  const [spacingStale, setSpacingStale] = useState(false);
  // The iframe's own PDF viewer renders a blank/dark frame for a moment
  // after the signed URL loads, before the PDF itself paints — without this,
  // that gap reads as "did this break" rather than "still loading".
  const [iframeLoaded, setIframeLoaded] = useState(false);
  useEffect(() => setIframeLoaded(false), [pdfSignedUrl]);

  const { sessionId, pendingContent, generatePreview } = useTailoringStore();
  const isTailoringMode = pendingContent !== null;
  const router = useRouter();

  function handleSpacingChange(nextLineSpacing: number, nextParagraphSpacing: number) {
    setSpacing(nextLineSpacing, nextParagraphSpacing);
    if (pdfSignedUrl) setSpacingStale(true);
  }

  function handleFontChange(nextFontChoice: string) {
    setFontChoice(nextFontChoice);
    if (pdfSignedUrl) setSpacingStale(true);
  }

  function handleAccentChange(nextAccentColor: string) {
    setAccentColor(nextAccentColor);
    if (pdfSignedUrl) setSpacingStale(true);
  }

  // Generate preview and update the iframe.
  async function handleGeneratePdf() {
    if (!resumeId) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      const { signed_url } = await apiClient.generatePdf(
        resumeId,
        templateId,
        undefined,
        lineSpacing,
        paragraphSpacing,
        fontChoice,
        accentColor
      );
      setPdfSignedUrl(signed_url);
      setSpacingStale(false);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  // This panel only mounts once the studio page's "Preview" toggle opens the
  // split pane, so mounting IS "the user just asked to see a preview" —
  // render one immediately instead of making them click "Refresh preview" a
  // second time. Skipped when a preview already exists (e.g. the resume had
  // one from a previous session — the studio page opens the pane with it
  // already loaded) and in tailoring mode, where BulletReviewPanel owns the
  // first render.
  useEffect(() => {
    if (!isTailoringMode && resumeId && !pdfSignedUrl) {
      handleGeneratePdf();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="flex items-center px-lg py-md border-b border-outline-variant/20 flex-shrink-0 bg-surface-container-lowest flex-wrap gap-sm">
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
            <div className="flex items-center gap-xs">
              <label htmlFor="font-choice" className="text-label-sm text-on-surface-variant whitespace-nowrap">
                Font
              </label>
              <select
                id="font-choice"
                value={fontChoice}
                onChange={(e) => handleFontChange(e.target.value)}
                className="px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface text-label-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
              >
                {FONT_CHOICES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-xs">
              <label htmlFor="accent-color" className="text-label-sm text-on-surface-variant whitespace-nowrap">
                Accent color
              </label>
              <input
                id="accent-color"
                type="color"
                value={accentColor ?? TEMPLATE_DEFAULT_ACCENT[templateId] ?? "#111111"}
                onChange={(e) => handleAccentChange(e.target.value)}
                className="w-8 h-8 rounded-md border border-outline-variant/50 cursor-pointer bg-transparent p-0"
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-sm ml-auto">
          {isDirty && (
            <span className="text-label-sm text-on-surface-variant italic">
              Saving…
            </span>
          )}
          {genError && (
            <span className="text-label-sm text-error">{genError}</span>
          )}
          {/* This button only ever refreshes the live preview render — the
              actual PDF download lives in the header's single "Download PDF"
              button, so this never wears a download icon/label (that read as
              a second, redundant download action). Hidden in tailoring mode
              — the BulletReviewPanel owns that flow. */}
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
              ) : (
                <ArrowsClockwise size={16} />
              )}
              {isGenerating ? "Refreshing…" : spacingStale ? "Update preview" : "Refresh preview"}
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
              ) : (
                <ArrowsClockwise size={16} />
              )}
              {isGenerating ? "Refreshing…" : spacingStale ? "Update preview" : "Preview up to date"}
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
            <div className="relative w-full" style={{ aspectRatio: "1 / 1.414", minHeight: "800px" }}>
              {!iframeLoaded && (
                <div className="absolute inset-0 rounded-xl border border-outline-variant/20 bg-surface-container-lowest flex items-center justify-center">
                  <SpinnerGap size={28} className="text-primary animate-spin" />
                </div>
              )}
              <iframe
                // #toolbar=0 hides the browser's own embedded PDF
                // viewer chrome (its download/print bar) — the header's
                // "Download PDF" is the one place to actually download.
                src={withHiddenToolbar(pdfSignedUrl)}
                onLoad={() => setIframeLoaded(true)}
                className="absolute inset-0 w-full h-full rounded-xl border border-outline-variant/20 shadow-xl bg-white"
                title="Resume Preview"
              />
            </div>
          ) : (
            <div className="w-full rounded-xl border-2 border-dashed border-outline-variant/50 flex items-center justify-center bg-white/70"
              style={{ aspectRatio: "1 / 1.414", minHeight: "800px" }}
            >
              <div className="text-center px-lg">
                <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center mx-auto mb-md">
                  <FileText size={32} className="text-on-surface-variant" />
                </div>
                <p className="text-on-surface text-body-md font-bold mb-sm">No preview yet</p>
                <p className="text-on-surface-variant text-body-sm">
                  Click &ldquo;Refresh preview&rdquo; to see your resume,
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
