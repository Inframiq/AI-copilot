"use client";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ClockCounterClockwise, DownloadSimple, Sparkle, X } from "@phosphor-icons/react";
import { EditorPanel } from "@/components/resume/EditorPanel";
import { PreviewPanel } from "@/components/resume/PreviewPanel";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient } from "@/lib/api-client";
import type { Resume } from "@career-copilot/types";

export default function StudioPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const setResume = useResumeStore((s) => s.setResume);
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);
  const storeResumeId = useResumeStore((s) => s.resumeId);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const { data: resume, isLoading, isError } = useQuery<Resume>({
    queryKey: ["resume", resumeId],
    queryFn: () => apiClient.getResume(resumeId),
    enabled: !!resumeId,
    // Serve immediately from the resumes list cache (populated by dashboard/studio index)
    initialData: () => {
      const list = queryClient.getQueryData<Resume[]>(["resumes"]);
      return list?.find((r) => r.id === resumeId);
    },
    // Keep cache fresh for 2 minutes — avoids redundant refetches on tab switch
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (resume) {
      setResume(resume.id, resume.content, resume.template_id);
    }
  }, [resume, setResume]);

  async function handleExportPdf() {
    if (!storeResumeId) return;
    setIsGeneratingPdf(true);
    setPdfError(null);
    try {
      const { signed_url } = await apiClient.generatePdf(storeResumeId, "ats_clean");
      setPdfSignedUrl(signed_url);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-md" />
          <p className="text-on-surface-variant text-body-sm">Loading resume…</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center px-lg" style={{ maxWidth: "24rem" }}>
          <p className="text-error text-headline-md font-bold mb-sm">Failed to load resume</p>
          <p className="text-on-surface-variant text-body-sm">
            The resume could not be found or you don&apos;t have access to it.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-lg px-lg py-md rounded-xl text-label-md text-on-primary bg-primary hover:opacity-90 transition-opacity"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background relative">
      {/* Glassmorphic Toolbar */}
      <header
        className="h-16 z-30 flex items-center justify-between px-lg border-b border-outline-variant/20 shrink-0"
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-4">
          <h2 className="text-headline-md text-primary font-semibold">
            {resume?.title || "Resume Studio"}
          </h2>
          <span className="px-2 py-1 bg-surface-variant text-on-surface-variant rounded text-caption uppercase tracking-wider">
            Draft
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors text-label-md">
            <ClockCounterClockwise size={20} />
            History
          </button>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleExportPdf}
              disabled={isGeneratingPdf || !storeResumeId}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-b from-primary to-primary-container text-on-primary rounded-xl shadow-md hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 text-label-md disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              <DownloadSimple size={20} />
              {isGeneratingPdf ? "Generating…" : "Export PDF"}
            </button>
            {pdfError && (
              <span className="text-caption text-error">{pdfError}</span>
            )}
          </div>
        </div>
      </header>

      {/* Split Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left Pane: Editor */}
        <section className="w-full lg:w-1/2 h-full overflow-y-auto bg-surface-container-lowest border-r border-outline-variant/20 relative z-10"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <EditorPanel />
        </section>

        {/* Right Pane: Live Preview */}
        <section className="hidden lg:flex w-1/2 h-full bg-surface-container-high relative justify-center items-start overflow-y-auto p-12">
          {/* Dot-grid background */}
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#767682 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
          <div className="relative z-10 w-full">
            <PreviewPanel />
          </div>
        </section>

        {/* Mobile: Preview below editor */}
        <section className="lg:hidden bg-surface-container-high">
          <PreviewPanel />
        </section>
      </div>

      {/* Floating AI Assistant */}
      {showAIPanel && (
        <div className="absolute bottom-6 right-6 z-50">
          <div
            className="p-4 rounded-2xl shadow-xl shadow-on-surface/10 flex flex-col border border-primary-container/30"
            style={{
              background: "rgba(255, 255, 255, 0.7)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              width: "20rem",
            }}
          >
            <div className="flex items-center gap-3 mb-3 border-b border-outline-variant/20 pb-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary">
                <Sparkle size={16} />
              </div>
              <span className="text-label-md text-primary font-bold">Resume Copilot</span>
              <button
                onClick={() => setShowAIPanel(false)}
                className="ml-auto text-secondary hover:text-on-surface transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-body-sm text-on-surface-variant mb-4">
              Your resume is looking good! Use the JD context in the editor to tailor it with AI.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAIPanel(false)}
                className="flex-1 py-1.5 px-3 rounded-lg border border-outline-variant text-secondary text-label-sm hover:bg-surface-container-low transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={() => router.push("/jd")}
                className="flex-1 py-1.5 px-3 bg-gradient-to-b from-primary to-primary-container text-on-primary rounded-xl shadow-md hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 text-label-sm"
              >
                Tailor Resume
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
