"use client";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { ArrowSquareOut, DownloadSimple } from "@phosphor-icons/react";

const TEMPLATE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "ats_clean", label: "ATS Clean" },
  { id: "ats_modern", label: "ATS Modern" },
];

export function PreviewPanel() {
  const resumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const pdfSignedUrl = useResumeStore((s) => s.pdfSignedUrl);
  const isDirty = useResumeStore((s) => s.isDirty);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);

  const { sessionId } = useTailoringStore();
  const router = useRouter();

  async function handleGeneratePdf() {
    if (!resumeId) return;
    try {
      const { signed_url } = await apiClient.generatePdf(resumeId, templateId);
      setPdfSignedUrl(signed_url);
    } catch (err) {
      console.error("PDF generation failed:", err);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls Bar */}
      <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/20 flex-shrink-0 bg-surface-container-lowest">
        {/* Template Switcher */}
        <div className="flex items-center gap-sm">
          {TEMPLATE_OPTIONS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTemplateId(t.id)}
              className={`px-md py-sm rounded-lg text-label-sm transition-colors ${
                templateId === t.id
                  ? "bg-secondary-container text-primary font-bold"
                  : "text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-sm">
          {isDirty && (
            <span className="text-label-sm text-on-surface-variant italic">
              Saving…
            </span>
          )}
          <button
            onClick={handleGeneratePdf}
            disabled={!resumeId}
            className="flex items-center gap-xs px-md py-sm rounded-lg text-label-sm text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <DownloadSimple size={16} />
            Generate PDF
          </button>
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
        {/* Dot-grid background pattern */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(#767682 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        <div className="relative z-10 flex justify-center items-start p-xl min-h-full">
          {pdfSignedUrl ? (
            <iframe
              src={pdfSignedUrl}
              className="w-full max-w-2xl rounded-xl border border-outline-variant/20 shadow-xl bg-white"
              style={{ aspectRatio: "1 / 1.414", minHeight: "600px" }}
              title="Resume Preview"
            />
          ) : (
            <div className="w-full max-w-2xl rounded-xl border-2 border-dashed border-outline-variant/50 flex items-center justify-center bg-white/70"
              style={{ aspectRatio: "1 / 1.414", minHeight: "600px" }}
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
