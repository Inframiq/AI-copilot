"use client";
import { use, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CheckCircle, DownloadSimple, Eye, EyeSlash, PencilSimple, Sparkle, Spinner, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { EditorPanel } from "@/components/resume/EditorPanel";
import { PreviewPanel } from "@/components/resume/PreviewPanel";
import { PhotoRequirementModal } from "@/components/resume/PhotoRequirementModal";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { RESUME_TEMPLATES, templateRequiresPhoto } from "@/lib/resume-templates";
import { getCareerProfile, type CareerProfileInput } from "@/lib/career-profile-client";
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
  const pdfSignedUrl = useResumeStore((s) => s.pdfSignedUrl);
  const storeResumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const lineSpacing = useResumeStore((s) => s.lineSpacing);
  const paragraphSpacing = useResumeStore((s) => s.paragraphSpacing);
  const previewOpen = useResumeStore((s) => s.previewOpen);
  const setPreviewOpen = useResumeStore((s) => s.setPreviewOpen);
  const content = useResumeStore((s) => s.content);
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);
  const isDirty = useResumeStore((s) => s.isDirty);
  const isSaving = useResumeStore((s) => s.isSaving);
  const saveError = useResumeStore((s) => s.saveError);
  const saveNow = useResumeStore((s) => s.saveNow);
  // A tailoring session already exists once the user has come from
  // "Tailor Resume" on either JD page — nagging them to go tailor again
  // right after they just did is the bug being fixed here.
  const hasTailoringSession = useTailoringStore((s) => s.sessionId !== null);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfDownloaded, setPdfDownloaded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSwitchingTemplate, setIsSwitchingTemplate] = useState(false);

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

  // Shared ["careerProfile"] cache key — the same one profile/page.tsx and
  // <PhotoRequirementModal> ("also save to profile") invalidate.
  const { data: careerProfile } = useQuery({
    queryKey: ["careerProfile"],
    queryFn: getCareerProfile,
    staleTime: 5 * 60 * 1000,
  });

  const profileForUpsert: CareerProfileInput | null = careerProfile
    ? {
        master_resume_id: careerProfile.master_resume_id,
        contact: careerProfile.contact,
        headline: careerProfile.headline,
        experience: careerProfile.experience,
        projects: careerProfile.projects,
        education: careerProfile.education,
        skills: careerProfile.skills,
        certifications: careerProfile.certifications,
        role_status: careerProfile.role_status,
        photo_url: careerProfile.photo_url,
        photo_path: careerProfile.photo_path,
      }
    : null;

  useEffect(() => {
    // Skip if the store is already hydrated for this exact resume — e.g. we
    // just navigated here right after AI tailoring, which already wrote the
    // tailored content and a fresh PDF preview into the store. Re-applying
    // the (possibly stale, since tailoring's save doesn't invalidate this
    // query) fetched copy would blow away that preview, including resetting
    // pdfSignedUrl to null.
    if (resume && resume.id !== storeResumeId) {
      setResume(
        resume.id,
        resume.content,
        resume.template_id,
        resume.line_spacing,
        resume.paragraph_spacing,
        resume.font_choice,
        resume.accent_color
      );
    }
  }, [resume, storeResumeId, setResume]);

  // A saved resume that's already had a PDF generated (e.g. opened via
  // "Open" from a JD's "Generated for This JD" card) should show that PDF
  // immediately, not present "No PDF generated yet" and make the user
  // click Generate for content that's already sitting in storage. Cheap
  // signed-URL lookup, not a re-render — runs once per resume load, right
  // after setResume above resets pdfSignedUrl to null for it.
  useEffect(() => {
    if (!resume || resume.id !== storeResumeId || pdfSignedUrl || !resume.pdf_url) return;
    let cancelled = false;
    apiClient.getLatestResumePdf(resume.id)
      .then(({ signed_url }) => {
        if (cancelled) return;
        setPdfSignedUrl(signed_url);
        // There's already something to show — open the split pane straight
        // to it instead of making the user click "Preview" for content
        // that's already sitting in storage.
        setPreviewOpen(true);
      })
      .catch(() => {}); // 404 (never generated) or a transient failure — Generate PDF still works as a fallback
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.id, storeResumeId]);

  // Prompt for a photo the first time the resume lands on a photo template
  // without one. prevTemplateIdRef starts null so this also fires on initial
  // hydration (setResume writes the real template id), not only on later
  // in-editor switches.
  const prevTemplateIdRef = useRef<string | null>(null);
  // Reset the "seen template" ref on client-side navigation between resumes,
  // so a second resume that shares the first's photo template but has no photo
  // still gets prompted (the ref otherwise persists across the route change).
  useEffect(() => {
    prevTemplateIdRef.current = null;
  }, [resumeId]);
  useEffect(() => {
    if (storeResumeId !== resumeId || !content) return;
    const prev = prevTemplateIdRef.current;
    prevTemplateIdRef.current = templateId;
    if (templateId === prev) return;
    if (templateRequiresPhoto(templateId) && !content.contact.photo_url) {
      setPhotoModal(true, prev ?? undefined);
    }
  }, [templateId, storeResumeId, resumeId, content, setPhotoModal]);

  function startEditingTitle() {
    setTitleDraft(resume?.title ?? "");
    setTitleError(null);
    setIsEditingTitle(true);
  }

  async function saveTitle() {
    const nextTitle = titleDraft.trim();
    setIsEditingTitle(false);
    if (!resume || !nextTitle || nextTitle === resume.title) return;

    const previousTitle = resume.title;
    // Optimistic update — reflect the rename immediately, everywhere it's cached.
    queryClient.setQueryData<Resume>(["resume", resumeId], (r) =>
      r ? { ...r, title: nextTitle } : r
    );
    queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
      list?.map((r) => (r.id === resumeId ? { ...r, title: nextTitle } : r))
    );

    try {
      await apiClient.updateResume(resumeId, { title: nextTitle });
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Rename failed");
      queryClient.setQueryData<Resume>(["resume", resumeId], (r) =>
        r ? { ...r, title: previousTitle } : r
      );
      queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
        list?.map((r) => (r.id === resumeId ? { ...r, title: previousTitle } : r))
      );
    }
  }

  async function handleDeleteResume() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.deleteResume(resumeId);
      queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
        list?.filter((r) => r.id !== resumeId)
      );
      queryClient.removeQueries({ queryKey: ["resume", resumeId] });
      useResumeStore.getState().resetStore();
      router.push("/studio");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete resume");
      setIsDeleting(false);
      setDeleteArmed(false);
    }
  }

  // The one place template gets switched — was previously duplicated between
  // a full grid tab in the editor and a pill/dropdown in the preview panel.
  // Re-renders the preview in place if one's already showing; otherwise just
  // records the choice (rendering happens whenever the user next asks for a
  // preview or download).
  async function handleTemplateChange(id: string) {
    setTemplateId(id);
    if (!storeResumeId || !pdfSignedUrl) return;
    setIsSwitchingTemplate(true);
    try {
      const { signed_url } = await apiClient.generatePdf(storeResumeId, id, undefined, lineSpacing, paragraphSpacing);
      setPdfSignedUrl(signed_url);
    } catch {
      // Best-effort re-render — the template choice itself is already saved;
      // the next explicit preview/download retries the render.
    } finally {
      setIsSwitchingTemplate(false);
    }
  }

  async function handleExportPdf() {
    if (!storeResumeId) return;
    setIsGeneratingPdf(true);
    setPdfError(null);
    try {
      const { signed_url } = await apiClient.generatePdf(storeResumeId, templateId);
      // Update the in-app preview too
      setPdfSignedUrl(signed_url);
      // Fetch as a blob so we can force a real file download regardless of CORS
      const response = await fetch(signed_url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${resume?.title ?? "resume"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setPdfDownloaded(true);
      setTimeout(() => setPdfDownloaded(false), 2500);
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
          {isEditingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setIsEditingTitle(false);
              }}
              maxLength={200}
              className="text-headline-md text-primary font-semibold bg-transparent border-b-2 border-primary outline-none"
            />
          ) : (
            <button
              onClick={startEditingTitle}
              className="group flex items-center gap-2 text-headline-md text-primary font-semibold hover:opacity-80 transition-opacity"
              title="Rename resume"
            >
              {resume?.title || "Resume Studio"}
              <PencilSimple size={16} className="opacity-0 group-hover:opacity-60 transition-opacity" />
            </button>
          )}
          {saveError ? (
            <button
              onClick={() => saveNow()}
              title={saveError}
              className="flex items-center gap-1 px-2 py-1 bg-error-container/30 text-error rounded text-caption font-semibold hover:bg-error-container/50 transition-colors"
            >
              <WarningCircle size={14} weight="fill" /> Failed to save · Retry
            </button>
          ) : isSaving ? (
            <span className="flex items-center gap-1 px-2 py-1 bg-surface-variant text-on-surface-variant rounded text-caption uppercase tracking-wider">
              <Spinner size={12} className="animate-spin" /> Saving…
            </span>
          ) : isDirty ? (
            <span className="px-2 py-1 bg-surface-variant text-on-surface-variant rounded text-caption uppercase tracking-wider">
              Unsaved changes
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-1 bg-surface-variant text-on-surface-variant rounded text-caption uppercase tracking-wider">
              <CheckCircle size={12} weight="fill" /> Saved
            </span>
          )}
          {titleError && <span className="text-caption text-error">{titleError}</span>}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={templateId}
            onChange={(e) => handleTemplateChange(e.target.value)}
            disabled={isSwitchingTemplate}
            title="Change template"
            className="px-3 py-2 rounded-lg border border-outline-variant/50 bg-surface text-label-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all disabled:opacity-60 cursor-pointer"
          >
            {RESUME_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button
            onClick={() => setPreviewOpen(!previewOpen)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-label-md transition-all ${
              previewOpen
                ? "bg-secondary-container text-on-secondary-container font-semibold"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            {previewOpen ? <EyeSlash size={20} /> : <Eye size={20} />}
            {previewOpen ? "Hide Preview" : "Preview"}
          </button>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleDeleteResume}
              disabled={isDeleting}
              title={deleteArmed ? "Click again to confirm" : "Delete resume"}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-label-md transition-all disabled:opacity-50 ${
                deleteArmed
                  ? "bg-error text-on-primary"
                  : "text-on-surface-variant hover:bg-error-container/50 hover:text-error"
              }`}
            >
              <Trash size={20} />
              {deleteArmed && (isDeleting ? "Deleting…" : "Confirm delete")}
            </button>
            {deleteError && <span className="text-caption text-error">{deleteError}</span>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleExportPdf}
              disabled={isGeneratingPdf || !storeResumeId}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl shadow-md hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 text-label-md disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              <DownloadSimple size={20} />
              {isGeneratingPdf ? "Generating…" : "Download PDF"}
            </button>
            {pdfError && (
              <span className="text-caption text-error">{pdfError}</span>
            )}
            {pdfDownloaded && !pdfError && (
              <span className="text-caption text-success">Downloaded ✓</span>
            )}
          </div>
        </div>
      </header>

      {/* Workspace — full-width editor until Preview is opened, so an empty
          "no preview yet" pane doesn't eat half the screen for a resume
          nobody's asked to render yet. Single <PreviewPanel> instance
          (previously mounted twice — once hidden per breakpoint — which
          would have doubled its on-open auto-generate call). */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        <section
          className={`w-full h-full overflow-y-auto bg-surface-container-lowest relative z-10 ${
            previewOpen ? "lg:w-1/2 border-r border-outline-variant/20" : ""
          }`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <EditorPanel />
        </section>

        {previewOpen && (
          <section className="w-full lg:w-1/2 h-full overflow-hidden flex flex-col bg-surface-container-high lg:bg-transparent">
            <PreviewPanel />
          </section>
        )}
      </div>

      {/* Floating AI Assistant — only nag to tailor if there's no tailoring
          session yet for this resume; otherwise the user just did exactly
          what this panel is suggesting. */}
      {showAIPanel && !hasTailoringSession && (
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
                className="flex-1 py-1.5 px-3 bg-primary text-on-primary rounded-xl shadow-md hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 text-label-sm"
              >
                Tailor Resume
              </button>
            </div>
          </div>
        </div>
      )}

      <PhotoRequirementModal
        profilePhotoUrl={careerProfile === undefined ? undefined : careerProfile?.photo_url ?? null}
        profileForUpsert={profileForUpsert}
        onOpenProfile={() => {
          setPhotoModal(false);
          router.push("/profile");
        }}
      />
    </div>
  );
}
