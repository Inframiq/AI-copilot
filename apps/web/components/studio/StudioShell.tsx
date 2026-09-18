"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  useTailoringStore,
  type BulletChange,
} from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient } from "@/lib/api-client";
import { deriveSteps, currentStepId, type StepId } from "@/lib/studio-steps";
import type { SectionId } from "@/lib/section-completeness";
import type { CareerProfile } from "@/lib/career-profile-client";
import type { Resume } from "@career-copilot/types";
import { CommandBar } from "./CommandBar";
import { StepSpine } from "./spine/StepSpine";
import { SectionRail } from "./rail/SectionRail";
import { BoostPanel } from "./rail/BoostPanel";
import { SectionChain } from "./canvas/SectionChain";
import { SummaryCard } from "./review/SummaryCard";
import { SkillsCard } from "./review/SkillsCard";
import { TriageDeck } from "./review/TriageDeck";
import { PreviewDock } from "./preview/PreviewDock";

// The workbench: one shell holding the command bar, the step spine, the
// section rail, the canvas (section chain, or the review deck) and the
// preview dock. Replaces the studio page's old header + 50/50 split pane.
//
// The tailoring handlers below are moved verbatim from
// components/resume/BulletReviewPanel.tsx — same apiClient calls, same
// arguments, same error state. Only their home changed.
export function StudioShell({
  resumeId: routeResumeId,
  resume,
  careerProfile,
}: {
  resumeId: string;
  resume: Resume | undefined;
  careerProfile: CareerProfile | null | undefined;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Tailoring store ──────────────────────────────────────────────────────
  const pendingContent = useTailoringStore((s) => s.pendingContent);
  const bulletDecisions = useTailoringStore((s) => s.bulletDecisions);
  const setBulletDecision = useTailoringStore((s) => s.setBulletDecision);
  const setAllBulletDecisions = useTailoringStore((s) => s.setAllBulletDecisions);
  const applyBulletDecisions = useTailoringStore((s) => s.applyBulletDecisions);
  const updatePendingBullet = useTailoringStore((s) => s.updatePendingBullet);
  const updatePendingSummary = useTailoringStore((s) => s.updatePendingSummary);
  const generatePreview = useTailoringStore((s) => s.generatePreview);
  const reanalyzePreview = useTailoringStore((s) => s.reanalyzePreview);
  const saveTailoredResume = useTailoringStore((s) => s.saveTailoredResume);
  const previewPdfUrl = useTailoringStore((s) => s.previewPdfUrl);
  const discardPending = useTailoringStore((s) => s.discardPending);
  const companyKeywords = useTailoringStore((s) => s.companyKeywords);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const suggestedSkills = useTailoringStore((s) => s.suggestedSkills);
  const prioritySkills = useTailoringStore((s) => s.prioritySkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const bulletImportance = useTailoringStore((s) => s.bulletImportance);
  const atsFixes = useTailoringStore((s) => s.atsFixes);
  const projectedAtsScore = useTailoringStore((s) => s.projectedAtsScore);
  const setFixDecision = useTailoringStore((s) => s.setFixDecision);
  const refreshProjectedScore = useTailoringStore((s) => s.refreshProjectedScore);
  const humanizeLevel = useTailoringStore((s) => s.humanizeLevel);
  const jdId = useTailoringStore((s) => s.jdId);
  const jdText = useTailoringStore((s) => s.jdText);
  const runTailoring = useTailoringStore((s) => s.runTailoring);
  const isTailoring = useTailoringStore((s) => s.isLoading);

  // ── Resume store ─────────────────────────────────────────────────────────
  // `resumeId` deliberately shadows nothing: the moved handlers all mean the
  // *store's* resume id (hydrated), never the route param, so it keeps that
  // name and the route param is aliased above.
  const resumeId = useResumeStore((s) => s.resumeId);
  const originalContent = useResumeStore((s) => s.content);
  const templateId = useResumeStore((s) => s.templateId);
  const lineSpacing = useResumeStore((s) => s.lineSpacing);
  const paragraphSpacing = useResumeStore((s) => s.paragraphSpacing);
  const fontChoice = useResumeStore((s) => s.fontChoice);
  const accentColor = useResumeStore((s) => s.accentColor);
  const pdfSignedUrl = useResumeStore((s) => s.pdfSignedUrl);
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);
  const setPreviewUnderfilled = useResumeStore((s) => s.setPreviewUnderfilled);
  const isDirty = useResumeStore((s) => s.isDirty);
  // Named apart from the tailored-save state below, which is what the moved
  // handlers call `isSaving` / `saveError`.
  const storeIsSaving = useResumeStore((s) => s.isSaving);
  const storeSaveError = useResumeStore((s) => s.saveError);
  const saveNow = useResumeStore((s) => s.saveNow);

  const isMasterResume =
    !!resumeId && careerProfile?.master_resume_id === resumeId;

  // ── Local state carried over with the handlers ───────────────────────────
  const [isRetailoring, setIsRetailoring] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [everPreviewed, setEverPreviewed] = useState(false);
  const [showSaveChoice, setShowSaveChoice] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasHumanized, setHasHumanized] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [bulletLoading, setBulletLoading] = useState<Record<string, "rewrite" | "humanize" | null>>({});
  const [summaryLoading, setSummaryLoading] = useState<"rewrite" | "humanize" | "custom" | null>(null);
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // ── Command-bar state ────────────────────────────────────────────────────
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);

  // ── Preview-dock state ───────────────────────────────────────────────────
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Bullet changes (experience only) ─────────────────────────────────────
  // Copied verbatim from BulletReviewPanel.
  const bulletChanges = useMemo<BulletChange[]>(() => {
    if (!pendingContent || !originalContent) return [];
    const out: BulletChange[] = [];
    pendingContent.experience.forEach((job, jobIdx) => {
      const origJob = originalContent.experience[jobIdx];
      job.bullets.forEach((bullet, bulletIdx) => {
        const origBullet = origJob?.bullets[bulletIdx] ?? "";
        if (bullet.trim() !== origBullet.trim()) {
          out.push({
            key: `exp${jobIdx}_b${bulletIdx}`,
            jobIdx,
            bulletIdx,
            jobTitle: job.title || origJob?.title || "Unknown Role",
            company: job.company || origJob?.company || "",
            original: origBullet,
            tailored: bullet,
          });
        }
      });
    });
    return out;
  }, [pendingContent, originalContent]);

  // JD-gap skills come through as `type:"skill"` fixes. They render inside the
  // single SkillsCard (as chips carrying their own importance + "+N%"), so
  // drop any plain suggestion with the same name — each skill is chosen once.
  const skillFixes = useMemo(() => atsFixes.filter((f) => f.type === "skill"), [atsFixes]);
  const fixSkillNames = useMemo(
    () => new Set(skillFixes.map((f) => f.text.toLowerCase())),
    [skillFixes],
  );
  const dedupedSuggestedSkills = useMemo(
    () => suggestedSkills.filter((s) => !fixSkillNames.has(s.toLowerCase())),
    [suggestedSkills, fixSkillNames],
  );

  // ── Moved from BulletReviewPanel, unchanged ──────────────────────────────

  // Re-run tailoring with the same JD — discards current review and starts fresh.
  async function handleRetailor() {
    if (!resumeId || !jdText.trim()) return;
    setIsRetailoring(true);
    discardPending();
    setEverPreviewed(false);
    await runTailoring(resumeId);
    setIsRetailoring(false);
  }

  async function handleRewriteBullet(
    change: BulletChange,
    mode: "rewrite" | "humanize",
  ) {
    setBulletLoading((prev) => ({ ...prev, [change.key]: mode }));
    try {
      const { rewritten_text } = await apiClient.rewriteBullet({
        bullet_text: change.tailored,
        mode,
        jd_context: mode === "rewrite" ? jdText : undefined,
        humanize_level: humanizeLevel,
      });
      updatePendingBullet(change.jobIdx, change.bulletIdx, rewritten_text);
      // Auto-accept the updated version
      setBulletDecision(change.key, "accept");
      if (mode === "humanize") setHasHumanized(true);
    } catch {
      // silently fail — original tailored text stays
    } finally {
      setBulletLoading((prev) => ({ ...prev, [change.key]: null }));
    }
  }

  async function handleRewriteSummary(mode: "rewrite" | "humanize" | "custom") {
    const currentSummary = pendingContent?.summary?.trim();
    if (!currentSummary) return;
    if (mode === "custom" && !summaryPrompt.trim()) return;
    setSummaryLoading(mode);
    setSummaryError(null);
    try {
      const { rewritten_text } = await apiClient.rewriteBullet({
        bullet_text: currentSummary,
        mode,
        jd_context: mode === "rewrite" ? jdText : undefined,
        humanize_level: humanizeLevel,
        custom_instruction: mode === "custom" ? summaryPrompt.trim() : undefined,
        field: "summary",
      });
      updatePendingSummary(rewritten_text);
      // Auto-accept the updated version
      setBulletDecision("summary", "accept");
      if (mode === "custom") setSummaryPrompt("");
      if (mode === "humanize") setHasHumanized(true);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setSummaryLoading(null);
    }
  }

  async function handleReanalyze() {
    if (!resumeId) return;
    setReanalyzeError(null);
    try {
      await reanalyzePreview(resumeId);
    } catch (err) {
      setReanalyzeError(err instanceof Error ? err.message : "Reanalyze failed");
    }
  }

  // Unsaved review progress (accept/reject/rewrite/humanize decisions) only
  // lives in this in-memory store — closing or navigating away without
  // saving loses it, so warn before that happens. Guarded on pendingContent
  // because the shell, unlike BulletReviewPanel, is mounted the whole time.
  useEffect(() => {
    if (!pendingContent) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pendingContent]);

  async function handleGeneratePreview() {
    if (!resumeId) return;
    // The split preview pane is hidden until requested — this button is a
    // preview request, so reveal it now rather than rendering into a pane
    // the user can't see.
    useResumeStore.getState().setPreviewOpen(true);
    setIsGenerating(true);
    setGenerateError(null);
    try {
      await generatePreview(resumeId);
      setEverPreviewed(true);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Preview generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleDownload() {
    if (!previewPdfUrl) return;
    const response = await fetch(previewPdfUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "tailored-resume.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }

  async function handleSave(mode: "update" | "new") {
    if (!resumeId) return;
    // Belt-and-braces: the master resume's "Update" button isn't rendered,
    // and the backend 409s on it anyway — never send the request.
    if (mode === "update" && isMasterResume) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const targetId = await saveTailoredResume(resumeId, mode, newTitle);
      setShowSaveChoice(false);
      if (mode === "new") router.push(`/studio/${targetId}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  // ── Command-bar handlers (ported from the page header) ───────────────────

  async function handleRename(nextTitle: string) {
    if (!resume) return;
    const previousTitle = resume.title;
    setTitleError(null);
    // Optimistic update — reflect the rename immediately, everywhere it's cached.
    queryClient.setQueryData<Resume>(["resume", routeResumeId], (r) =>
      r ? { ...r, title: nextTitle } : r
    );
    queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
      list?.map((r) => (r.id === routeResumeId ? { ...r, title: nextTitle } : r))
    );

    try {
      await apiClient.updateResume(routeResumeId, { title: nextTitle });
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Rename failed");
      queryClient.setQueryData<Resume>(["resume", routeResumeId], (r) =>
        r ? { ...r, title: previousTitle } : r
      );
      queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
        list?.map((r) => (r.id === routeResumeId ? { ...r, title: previousTitle } : r))
      );
    }
  }

  async function handleDeleteResume() {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await apiClient.deleteResume(routeResumeId);
      queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
        list?.filter((r) => r.id !== routeResumeId)
      );
      queryClient.removeQueries({ queryKey: ["resume", routeResumeId] });
      useResumeStore.getState().resetStore();
      router.push("/studio");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete resume");
      setIsDeleting(false);
    }
  }

  async function handleExportPdf() {
    if (!resumeId) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const { signed_url, underfilled } = await apiClient.generatePdf(resumeId, templateId);
      // Update the in-app preview too
      setPdfSignedUrl(signed_url);
      setPreviewUnderfilled(underfilled ?? false);
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
      setExportDone(true);
      setTimeout(() => setExportDone(false), 2500);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setIsExporting(false);
    }
  }

  // ── Preview dock ─────────────────────────────────────────────────────────
  const previewUrl = previewPdfUrl ?? pdfSignedUrl;

  // Ported from PreviewPanel.handleGeneratePdf — the plain (non-tailoring)
  // render path, spacing/font/accent included.
  async function handleRefreshPlainPreview() {
    if (!resumeId) return;
    setIsRefreshing(true);
    try {
      const { signed_url, underfilled } = await apiClient.generatePdf(
        resumeId,
        templateId,
        undefined,
        lineSpacing,
        paragraphSpacing,
        fontChoice,
        accentColor
      );
      setPdfSignedUrl(signed_url);
      setPreviewUnderfilled(underfilled ?? false);
    } catch {
      // Best-effort render — the dock keeps showing the last good frame and
      // the button stays available for another try.
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleDockRefresh() {
    if (pendingContent) {
      await handleGeneratePreview();
      return;
    }
    await handleRefreshPlainPreview();
  }

  // ── Steps ────────────────────────────────────────────────────────────────
  const steps = deriveSteps({
    jdId,
    jdText,
    atsScore,
    pendingContent,
    previewPdfUrl,
    pdfSignedUrl,
    isDirty,
    hasSavedRender: !!resume?.pdf_url,
  });
  const derivedStep = currentStepId(steps);
  const [activeStep, setActiveStep] = useState<StepId>(derivedStep);
  // The spine follows the flow, but a manual pick stays put until the flow
  // itself moves on — otherwise looking back at Source would snap away.
  const lastDerivedRef = useRef<StepId>(derivedStep);
  useEffect(() => {
    if (lastDerivedRef.current === derivedStep) return;
    lastDerivedRef.current = derivedStep;
    setActiveStep(derivedStep);
  }, [derivedStep]);

  // ── Rail / chain ─────────────────────────────────────────────────────────
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const [railPinned, setRailPinned] = useState<boolean | null>(null); // null = automatic
  const [focusEntry, setFocusEntry] = useState<{ section: SectionId; index: number } | undefined>();

  // A band taking the floor hands it the rail's 260px too. A manual pin
  // wins for the rest of the session — the automatic behaviour is a
  // convenience, not a cage.
  const railCollapsed = railPinned ?? (openSection !== null || activeStep === "review");

  const pendingBySection = useMemo<Partial<Record<SectionId, number>>>(() => {
    // Every bullet change belongs to an experience entry — that is what
    // bulletChanges is built from — so the count lands on one section.
    if (bulletChanges.length === 0) return {};
    return { experience: bulletChanges.length };
  }, [bulletChanges]);

  const isReviewing = activeStep === "review" && pendingContent !== null;

  const canvas = isReviewing ? (
    <>
      <SummaryCard
        original={originalContent?.summary ?? ""}
        tailored={pendingContent?.summary ?? ""}
        decision={bulletDecisions["summary"] as "accept" | "reject" | undefined}
        busy={summaryLoading}
        error={summaryError}
        prompt={summaryPrompt}
        setPrompt={setSummaryPrompt}
        onDecide={(d) => setBulletDecision("summary", d)}
        onRewrite={handleRewriteSummary}
      />

      <TriageDeck
        changes={bulletChanges}
        decisions={bulletDecisions as Record<string, "accept" | "reject">}
        importance={bulletImportance}
        busy={bulletLoading}
        onDecide={setBulletDecision}
        onRewrite={handleRewriteBullet}
        onEdit={(change, text) =>
          updatePendingBullet(change.jobIdx, change.bulletIdx, text)
        }
        onTakeAllRemaining={() => setAllBulletDecisions(bulletChanges, "accept")}
      />

      <SkillsCard
        originalSkills={originalContent?.skills ?? []}
        suggestedSkills={dedupedSuggestedSkills}
        skillFixes={skillFixes}
        prioritySkills={prioritySkills}
        missingSkills={missingSkills}
        companyKeywords={companyKeywords}
        decisions={bulletDecisions}
        onDecide={setBulletDecision}
        onFixDecision={setFixDecision}
        onRefreshProjected={refreshProjectedScore}
        onApply={applyBulletDecisions}
      />

      {(generateError || reanalyzeError || saveError) && (
        <p className="text-caption text-error">
          {generateError ?? reanalyzeError ?? saveError}
        </p>
      )}

      {/* Review actions — the same four the old panel offered, minus the
          duplicated accept-all (the deck owns that now). */}
      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={handleGeneratePreview}
          disabled={isGenerating || !resumeId}
          className="flex items-center gap-xs rounded-xl bg-primary px-md py-sm text-label-md text-on-primary shadow-md transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGenerating
            ? "Rendering preview…"
            : everPreviewed
            ? "Regenerate preview"
            : "Preview tailored resume"}
        </button>
        {previewPdfUrl && (
          <>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-xl border border-outline-variant/40 px-md py-sm text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
            >
              Download
            </button>
            <button
              type="button"
              onClick={() => setShowSaveChoice((v) => !v)}
              className="rounded-xl border border-primary/40 px-md py-sm text-label-md text-primary transition-colors hover:bg-primary/5"
            >
              Save…
            </button>
          </>
        )}
        {hasHumanized && (
          <button
            type="button"
            onClick={handleReanalyze}
            className="rounded-xl border border-outline-variant/40 px-md py-sm text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            Reanalyze
          </button>
        )}
        {jdText.trim() && (
          <button
            type="button"
            onClick={handleRetailor}
            disabled={isRetailoring || isTailoring}
            className="rounded-xl border border-outline-variant/40 px-md py-sm text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-50"
          >
            {isRetailoring || isTailoring ? "Tailoring…" : "Re-tailor"}
          </button>
        )}
        <button
          type="button"
          onClick={discardPending}
          disabled={isRetailoring || isTailoring}
          className="rounded-xl border border-outline-variant/40 px-md py-sm text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-50"
        >
          Discard
        </button>
      </div>

      {showSaveChoice && (
        <div className="flex flex-col gap-sm rounded-2xl border border-primary/30 bg-primary/5 p-md">
          <p className="text-label-caps text-on-surface-variant">Save tailored resume</p>
          {!isMasterResume ? (
            <button
              type="button"
              onClick={() => handleSave("update")}
              disabled={isSaving}
              className="rounded-xl bg-primary px-md py-sm text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Update my resume"}
            </button>
          ) : (
            <p className="text-caption text-on-surface-variant">
              This is your profile&rsquo;s master resume — it stays untouched. Save the
              tailored version as a separate resume for this job.
            </p>
          )}
          <div className="flex items-center gap-sm">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Tailored Resume"
              aria-label="New resume title"
              className="flex-1 rounded-xl border border-outline-variant/50 bg-surface px-sm py-xs text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              onClick={() => handleSave("new")}
              disabled={isSaving}
              className="rounded-xl border border-primary/40 px-md py-xs text-label-sm text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save as new"}
            </button>
          </div>
        </div>
      )}
    </>
  ) : (
    <SectionChain
      content={originalContent}
      openSection={openSection}
      onOpenChange={setOpenSection}
      focusEntry={focusEntry}
    />
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <CommandBar
        title={resume?.title ?? ""}
        isDirty={isDirty}
        isSaving={storeIsSaving}
        saveError={storeSaveError}
        onRename={handleRename}
        renameError={titleError}
        onRetrySave={() => saveNow()}
        onExport={handleExportPdf}
        isExporting={isExporting}
        exportError={exportError}
        exportDone={exportDone}
        canExport={!!resumeId}
        onDelete={handleDeleteResume}
        isDeleting={isDeleting}
        deleteError={deleteError}
      />

      <StepSpine
        steps={steps}
        activeStep={activeStep}
        onSelect={setActiveStep}
        score={atsScore}
        projected={projectedAtsScore}
      />

      {/* Flex, not grid: the rail animates its own width, and a fixed grid
          track would fight that animation. */}
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden xl:flex">
          <SectionRail
            content={originalContent}
            activeSection={openSection ?? "contact"}
            collapsed={railCollapsed}
            onToggleCollapsed={() => setRailPinned(!railCollapsed)}
            onSelect={(id) => setOpenSection(id)}
            onSelectEntry={(id, index) => {
              setOpenSection(id);
              setFocusEntry({ section: id, index });
            }}
            pendingBySection={pendingBySection}
            footer={isReviewing ? <BoostPanel /> : null}
          />
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto px-lg py-xl">
          {/* The canvas widens when the rail folds away — that reclaimed
              space is the whole point of collapsing it. */}
          <motion.div
            layout
            transition={{ type: "spring", stiffness: 220, damping: 30 }}
            className={`mx-auto flex w-full flex-col gap-xl ${
              railCollapsed ? "max-w-[900px]" : "max-w-[720px]"
            }`}
          >
            {canvas}
          </motion.div>
        </main>

        <div className="hidden w-[44%] shrink-0 overflow-hidden xl:block">
          <PreviewDock
            url={previewUrl}
            isRefreshing={isRefreshing || isGenerating}
            isStale={!!previewUrl && isDirty}
            onRefresh={handleDockRefresh}
          />
        </div>
      </div>
    </div>
  );
}
