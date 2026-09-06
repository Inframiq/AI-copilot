"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  ArrowCounterClockwise,
  FilePdf,
  ArrowsClockwise,
  Sparkle,
  DownloadSimple,
  FloppyDisk,
  Copy,
  MagnifyingGlass,
  Target,
} from "@phosphor-icons/react";
import { useTailoringStore, type BulletChange, MAX_MERGED_SKILLS, defaultSkillKeepDecision } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient, type AtsFix } from "@/lib/api-client";
import { AtsGapFixPanel } from "./AtsGapFixPanel";
import { ImportanceBadge, type ImportanceLevel } from "./ImportanceBadge";

export function BulletReviewPanel() {
  const router = useRouter();
  const pendingContent = useTailoringStore((s) => s.pendingContent);
  const bulletDecisions = useTailoringStore((s) => s.bulletDecisions);
  const setBulletDecision = useTailoringStore((s) => s.setBulletDecision);
  const setAllBulletDecisions = useTailoringStore((s) => s.setAllBulletDecisions);
  const applyBulletDecisions = useTailoringStore((s) => s.applyBulletDecisions);
  const updatePendingBullet = useTailoringStore((s) => s.updatePendingBullet);
  const updatePendingSummary = useTailoringStore((s) => s.updatePendingSummary);
  const generatePreview = useTailoringStore((s) => s.generatePreview);
  const reanalyzePreview = useTailoringStore((s) => s.reanalyzePreview);
  const isReanalyzing = useTailoringStore((s) => s.isReanalyzing);
  const saveTailoredResume = useTailoringStore((s) => s.saveTailoredResume);
  const previewPdfUrl = useTailoringStore((s) => s.previewPdfUrl);
  const discardPending = useTailoringStore((s) => s.discardPending);
  const isApplying = useTailoringStore((s) => s.isApplying);
  const companyKeywords = useTailoringStore((s) => s.companyKeywords);
  const companyName = useTailoringStore((s) => s.companyName);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const suggestedSkills = useTailoringStore((s) => s.suggestedSkills);
  const prioritySkills = useTailoringStore((s) => s.prioritySkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const bulletImportance = useTailoringStore((s) => s.bulletImportance);
  const atsFixes = useTailoringStore((s) => s.atsFixes);
  const projectedAtsScore = useTailoringStore((s) => s.projectedAtsScore);
  const setFixDecision = useTailoringStore((s) => s.setFixDecision);
  const refreshProjectedScore = useTailoringStore((s) => s.refreshProjectedScore);
  // Not user-adjustable here anymore (the Writing Style slider that changed
  // this was removed as redundant) — still read for per-bullet Humanize.
  const humanizeLevel = useTailoringStore((s) => s.humanizeLevel);
  const jdText = useTailoringStore((s) => s.jdText);
  const runTailoring = useTailoringStore((s) => s.runTailoring);
  const isTailoring = useTailoringStore((s) => s.isLoading);

  const resumeId = useResumeStore((s) => s.resumeId);
  const originalContent = useResumeStore((s) => s.content);

  const [isRetailoring, setIsRetailoring] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Tracks whether a preview has ever been generated in this review session —
  // once true, a later Humanize/Rewrite/accept-reject clears previewPdfUrl
  // (see tailoring-store) and this flag relabels the button "Regenerate
  // Preview" instead of "Preview Tailored Resume", so it reads as "your
  // edit needs a fresh render" rather than starting over.
  const [everPreviewed, setEverPreviewed] = useState(false);
  const [showSaveChoice, setShowSaveChoice] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Humanize can lower keyword density, so the ATS Score shown above goes
  // stale the moment it's used — surface a way to re-check it once that's
  // happened, rather than silently leaving an outdated score on screen.
  const [hasHumanized, setHasHumanized] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  // Per-bullet loading: key → "rewrite" | "humanize" | null
  const [bulletLoading, setBulletLoading] = useState<Record<string, "rewrite" | "humanize" | null>>({});
  const [summaryLoading, setSummaryLoading] = useState<"rewrite" | "humanize" | "custom" | null>(null);
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // ── Bullet changes (experience only) ─────────────────────────────────────
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
  // single SkillsBlock (as chips carrying their own importance + "+N%"), so
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

  const acceptedBullets = bulletChanges.filter(
    (c) => (bulletDecisions[c.key] ?? "accept") === "accept",
  ).length;
  const allAccepted = bulletChanges.length > 0 && acceptedBullets === bulletChanges.length;

  const allDecided =
    bulletChanges.length === 0 || bulletChanges.every((c) => c.key in bulletDecisions);

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
  // saving loses it, so warn before that happens.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

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

  if (!pendingContent) return null;

  // ── Group bullets by job ──────────────────────────────────────────────────
  const groups = bulletChanges.reduce<
    Record<string, { label: string; changes: BulletChange[] }>
  >((acc, change) => {
    const groupKey = `${change.jobTitle}||${change.company}`;
    if (!acc[groupKey]) {
      acc[groupKey] = {
        label: change.company
          ? `${change.jobTitle} · ${change.company}`
          : change.jobTitle,
        changes: [],
      };
    }
    acc[groupKey].changes.push(change);
    return acc;
  }, {});

  if (bulletChanges.length === 0) {
    return (
      <div className="flex flex-col gap-md">
        <div className="rounded-xl border border-outline-variant/20 p-lg text-center bg-surface">
          <p className="text-body-sm text-on-surface-variant">
            No changes to review — your resume is already well-aligned with this JD.
          </p>
        </div>
        {/* Summary + Skills + generate still shown */}
        <SummaryBlock
          originalSummary={originalContent?.summary ?? ""}
          pendingSummary={pendingContent?.summary ?? ""}
          decision={bulletDecisions["summary"]}
          setBulletDecision={setBulletDecision}
          onRewrite={handleRewriteSummary}
          loading={summaryLoading}
          error={summaryError}
          prompt={summaryPrompt}
          setPrompt={setSummaryPrompt}
        />
        <AtsGapFixPanel />
        <SkillsBlock
          suggestedSkills={dedupedSuggestedSkills}
          skillFixes={skillFixes}
          prioritySkills={prioritySkills}
          missingSkills={missingSkills}
          companyKeywords={companyKeywords}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
          setFixDecision={setFixDecision}
          refreshProjectedScore={refreshProjectedScore}
          originalSkills={originalContent?.skills ?? []}
          applyBulletDecisions={applyBulletDecisions}
        />
        <div className="flex gap-sm">
          {jdText.trim() && (
            <button
              onClick={handleRetailor}
              disabled={isRetailoring || isTailoring}
              className="flex-1 flex items-center justify-center gap-xs py-sm rounded-xl text-label-md text-primary border border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              <Sparkle size={15} className={isRetailoring || isTailoring ? "animate-pulse" : ""} />
              {isRetailoring || isTailoring ? "Tailoring…" : "Re-tailor"}
            </button>
          )}
          <button
            onClick={discardPending}
            disabled={isRetailoring || isTailoring}
            className="flex-1 py-sm rounded-xl border border-outline-variant text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-label-md font-bold text-on-surface">Review AI Changes</p>
          <p className="text-caption text-on-surface-variant">
            {acceptedBullets} of {bulletChanges.length} bullet
            {bulletChanges.length !== 1 ? "s" : ""} accepted
            {atsScore !== null && (
              <>
                {" · ATS Score: "}
                {atsScore}%
                {projectedAtsScore !== null && projectedAtsScore !== atsScore && (
                  <span className="text-primary font-semibold"> → {projectedAtsScore}%</span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-xs">
          {/* Reanalyze: only shown once Humanize has been used, since that's
              what can make the ATS Score above stale. Scores the current
              unsaved bullet state, doesn't persist anything. */}
          {hasHumanized && (
            <button
              onClick={handleReanalyze}
              disabled={isReanalyzing}
              title="Re-check the ATS score against your current edits"
              className="flex items-center gap-xs px-sm py-xs rounded-lg text-caption text-primary border border-primary/30 hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MagnifyingGlass size={13} className={isReanalyzing ? "animate-pulse" : ""} />
              {isReanalyzing ? "Reanalyzing…" : "Reanalyze"}
            </button>
          )}
          {/* Re-tailor: re-run AI tailoring with the same JD from within the studio */}
          {jdText.trim() && (
            <button
              onClick={handleRetailor}
              disabled={isRetailoring || isTailoring}
              className="flex items-center gap-xs px-sm py-xs rounded-lg text-caption text-primary border border-primary/30 hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkle size={13} className={isRetailoring || isTailoring ? "animate-pulse" : ""} />
              {isRetailoring || isTailoring ? "Tailoring…" : "Re-tailor"}
            </button>
          )}
          <button
            onClick={discardPending}
            disabled={isRetailoring || isTailoring}
            className="flex items-center gap-xs px-sm py-xs rounded-lg text-caption text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container-low transition-colors disabled:opacity-50"
          >
            <ArrowCounterClockwise size={13} />
            Discard
          </button>
        </div>
      </div>
      {reanalyzeError && <p className="text-caption text-error">{reanalyzeError}</p>}

      {/* ── Company keywords ── */}
      {companyKeywords.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary-container/20 p-md flex flex-col gap-sm">
          <p className="text-label-sm font-bold text-primary">
            {companyName} ATS Keywords Injected
          </p>
          <div className="flex flex-wrap gap-xs">
            {companyKeywords.map((kw) => (
              <span
                key={kw}
                className="px-sm py-0.5 pill rounded-full bg-primary/10 text-primary text-caption font-medium border border-primary/20"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Summary ── */}
      <SummaryBlock
        originalSummary={originalContent?.summary ?? ""}
        pendingSummary={pendingContent?.summary ?? ""}
        decision={bulletDecisions["summary"]}
        setBulletDecision={setBulletDecision}
        onRewrite={handleRewriteSummary}
        loading={summaryLoading}
        error={summaryError}
        prompt={summaryPrompt}
        setPrompt={setSummaryPrompt}
      />

      {/* ── Bullet groups ── */}
      {Object.entries(groups).map(([groupKey, group]) => (
        <div key={groupKey} className="flex flex-col gap-sm">
          <p className="text-label-sm text-on-surface-variant font-bold uppercase tracking-wider">
            {group.label}
          </p>
          {group.changes.map((change) => {
            const isAccepted = (bulletDecisions[change.key] ?? "accept") === "accept";
            const isDecided = change.key in bulletDecisions;
            const loading = bulletLoading[change.key];
            const importance = bulletImportance[change.key];

            return (
              <div
                key={change.key}
                className={`rounded-xl border p-md flex flex-col gap-sm transition-all ${
                  !isDecided
                    ? "border-outline-variant/40 bg-surface"
                    : isAccepted
                    ? "border-primary/25 bg-primary/5"
                    : "border-outline-variant/20 bg-surface opacity-60"
                }`}
              >
                {importance && (
                  <div className="flex justify-end">
                    <ImportanceBadge level={importance} />
                  </div>
                )}

                {/* Original */}
                <div className="flex flex-col gap-xs">
                  <span className="text-caption text-on-surface-variant uppercase tracking-wider">
                    Original
                  </span>
                  <p className="text-body-sm text-on-surface-variant line-through leading-relaxed">
                    {change.original || (
                      <em className="not-italic opacity-50">— empty —</em>
                    )}
                  </p>
                </div>

                {/* AI Tailored */}
                <div className="flex flex-col gap-xs">
                  <span className="text-caption text-primary uppercase tracking-wider font-bold">
                    AI Tailored
                  </span>
                  <p className="text-body-sm text-on-surface leading-relaxed">
                    {change.tailored}
                  </p>
                </div>

                {/* Actions row */}
                <div className="flex items-center gap-xs pt-xs flex-wrap">
                  {/* Accept / Keep */}
                  <button
                    onClick={() => setBulletDecision(change.key, "accept")}
                    className={`flex items-center gap-xs px-md py-xs rounded-lg text-label-sm transition-all ${
                      isAccepted && isDecided
                        ? "bg-primary text-on-primary shadow-sm"
                        : "border border-outline-variant/40 text-on-surface-variant hover:border-primary hover:text-primary"
                    }`}
                  >
                    <Check size={14} weight={isAccepted && isDecided ? "bold" : "regular"} />
                    Accept
                  </button>
                  <button
                    onClick={() => setBulletDecision(change.key, "reject")}
                    className={`flex items-center gap-xs px-md py-xs rounded-lg text-label-sm transition-all ${
                      !isAccepted && isDecided
                        ? "bg-error text-on-error shadow-sm"
                        : "border border-outline-variant/40 text-on-surface-variant hover:border-error hover:text-error"
                    }`}
                  >
                    <X size={14} weight={!isAccepted && isDecided ? "bold" : "regular"} />
                    Keep original
                  </button>

                  {/* Divider */}
                  <span className="text-outline-variant/40 select-none">|</span>

                  {/* Rewrite */}
                  <button
                    disabled={!!loading}
                    onClick={() => handleRewriteBullet(change, "rewrite")}
                    title="Re-optimize this bullet for the JD"
                    className="flex items-center gap-xs px-sm py-xs rounded-lg text-label-sm border border-outline-variant/40 text-on-surface-variant hover:border-secondary hover:text-secondary transition-all disabled:opacity-40"
                  >
                    <ArrowsClockwise
                      size={13}
                      className={loading === "rewrite" ? "animate-spin" : ""}
                    />
                    {loading === "rewrite" ? "Rewriting…" : "Rewrite"}
                  </button>

                  {/* Humanize */}
                  <button
                    disabled={!!loading}
                    onClick={() => handleRewriteBullet(change, "humanize")}
                    title="Make this bullet sound more natural"
                    className="flex items-center gap-xs px-sm py-xs rounded-lg text-label-sm border border-outline-variant/40 text-on-surface-variant hover:border-tertiary hover:text-tertiary transition-all disabled:opacity-40"
                  >
                    <Sparkle
                      size={13}
                      className={loading === "humanize" ? "animate-pulse" : ""}
                    />
                    {loading === "humanize" ? "Humanizing…" : "Humanize"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Bottom action area ── */}
      <div className="flex flex-col gap-sm pt-xs border-t border-outline-variant/20 mt-xs">

        {/* 1. Gap → fix list (skills / bullets / headline) + running projected score */}
        <AtsGapFixPanel />

        {/* 1b. Existing-skills keep/drop + opt-in suggested skills */}
        <SkillsBlock
          suggestedSkills={dedupedSuggestedSkills}
          skillFixes={skillFixes}
          prioritySkills={prioritySkills}
          missingSkills={missingSkills}
          companyKeywords={companyKeywords}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
          setFixDecision={setFixDecision}
          refreshProjectedScore={refreshProjectedScore}
          originalSkills={originalContent?.skills ?? []}
          applyBulletDecisions={applyBulletDecisions}
        />

        {/* 2. Writing Style slider removed here — it duplicates the one
            already shown before generating (TailoringForm / the manual-paste
            form), and every bullet in this review already has its own
            Humanize button. humanizeLevel stays at whatever value was set
            pre-generation; per-bullet Humanize still uses it, just without a
            second control to change it at this stage. */}

        {/* 3. Accept All / Generate PDF — Accept All is always shown (not
            gated on allDecided): every changed bullet already defaults to
            "accept" the moment tailoring completes (see runTailoring's
            initialDecisions), so allDecided is true from the start and a
            !allDecided guard here would never render. Clicking it is a
            harmless no-op when nothing was rejected, and a real action when
            something was. Its style reflects current state — filled blue
            once every bullet actually is accepted, outlined otherwise —
            instead of looking the same regardless of what's already true. */}
        {bulletChanges.length > 0 && (
          <button
            onClick={() => setAllBulletDecisions(bulletChanges, "accept")}
            className={`w-full flex items-center justify-center gap-xs py-sm rounded-xl text-label-md transition-all ${
              allAccepted
                ? "text-on-primary bg-primary shadow-sm hover:opacity-90"
                : "text-primary border border-primary/40 hover:bg-primary/5"
            }`}
          >
            {allAccepted && <Check size={15} weight="bold" />}
            {allAccepted ? "All Bullets Accepted" : "Accept All"}
          </button>
        )}

        {allDecided && !previewPdfUrl && (
          <>
            {generateError && (
              <p className="text-caption text-error">{generateError}</p>
            )}
            <button
              onClick={handleGeneratePreview}
              disabled={isApplying || isGenerating || !resumeId}
              className="w-full flex items-center justify-center gap-sm py-md rounded-xl text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              <FilePdf size={18} />
              {isGenerating ? "Rendering preview…" : everPreviewed ? "Regenerate Preview" : "Preview Tailored Resume"}
            </button>
            <p className="text-caption text-on-surface-variant text-center">
              {everPreviewed
                ? "You made changes since the last preview — regenerate to see them reflected."
                : "This only renders a preview — your saved resume is not changed yet."}
            </p>
          </>
        )}

        {previewPdfUrl && (
          <div className="flex flex-col gap-sm">
            <p className="text-caption text-on-surface-variant text-center">
              Preview updated in the panel on the right — nothing has been saved yet.
            </p>
            <div className="flex gap-sm">
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-xs py-sm rounded-xl text-label-md text-on-surface border border-outline-variant/40 hover:bg-surface-container-low transition-all"
              >
                <DownloadSimple size={16} />
                Download
              </button>
              <button
                onClick={() => setShowSaveChoice(true)}
                className="flex-1 flex items-center justify-center gap-xs py-sm rounded-xl text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg transition-all"
              >
                <FloppyDisk size={16} />
                Save…
              </button>
            </div>
          </div>
        )}

        {showSaveChoice && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-md flex flex-col gap-sm">
            <p className="text-label-sm font-bold text-on-surface">Save tailored resume</p>
            {saveError && <p className="text-caption text-error">{saveError}</p>}
            <button
              onClick={() => handleSave("update")}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-xs py-sm rounded-lg text-label-sm text-on-primary bg-primary hover:bg-primary-container transition-all disabled:opacity-50"
            >
              <FloppyDisk size={14} />
              {isSaving ? "Saving…" : "Update my resume"}
            </button>
            <p className="text-caption text-on-surface-variant px-xs">
              Overwrites your current resume with this tailored version.
            </p>
            <div className="flex items-center gap-sm">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={companyName.trim() ? `Resume — ${companyName.trim()}` : "Tailored Resume"}
                className="flex-1 px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={() => handleSave("new")}
                disabled={isSaving}
                className="flex items-center gap-xs px-md py-xs rounded-lg text-label-sm text-primary border border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-50"
              >
                <Copy size={14} />
                {isSaving ? "Saving…" : "Save as new"}
              </button>
            </div>
            <p className="text-caption text-on-surface-variant px-xs">
              Keeps your current resume untouched and creates a separate copy for this job.
            </p>
            <button
              onClick={() => setShowSaveChoice(false)}
              className="text-caption text-on-surface-variant hover:underline self-end"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Professional Summary sub-component ───────────────────────────────────────
// Unlike bullets (already diffed by the initial tailoring pass), the summary
// starts identical to the original — nothing to review until the user
// explicitly asks for a rewrite via one of the three actions below.
function SummaryBlock({
  originalSummary,
  pendingSummary,
  decision,
  setBulletDecision,
  onRewrite,
  loading,
  error,
  prompt,
  setPrompt,
}: {
  originalSummary: string;
  pendingSummary: string;
  decision: string | undefined;
  setBulletDecision: (key: string, d: "accept" | "reject") => void;
  onRewrite: (mode: "rewrite" | "humanize" | "custom") => void;
  loading: "rewrite" | "humanize" | "custom" | null;
  error: string | null;
  prompt: string;
  setPrompt: (v: string) => void;
}) {
  if (!originalSummary.trim() && !pendingSummary.trim()) return null;
  const changed = pendingSummary.trim() !== originalSummary.trim();
  const accepted = (decision ?? "accept") === "accept";

  return (
    <div className="rounded-xl border border-outline-variant/20 p-md flex flex-col gap-sm bg-surface">
      <p className="text-label-md font-bold text-on-surface">Professional Summary</p>

      {changed && (
        <div className="flex flex-col gap-xs">
          <span className="text-caption text-on-surface-variant uppercase tracking-wider">Original</span>
          <p className="text-body-sm text-on-surface-variant line-through leading-relaxed">{originalSummary}</p>
        </div>
      )}

      <div className="flex flex-col gap-xs">
        <span
          className={`text-caption uppercase tracking-wider font-bold ${changed ? "text-primary" : "text-on-surface-variant"}`}
        >
          {changed ? "AI Tailored" : "Current"}
        </span>
        <p className="text-body-sm text-on-surface leading-relaxed">
          {pendingSummary || <em className="not-italic opacity-50">— empty —</em>}
        </p>
      </div>

      {changed && (
        <div className="flex items-center gap-xs">
          <button
            onClick={() => setBulletDecision("summary", "accept")}
            className={`flex items-center gap-xs px-md py-xs rounded-lg text-label-sm transition-all ${
              accepted
                ? "bg-primary text-on-primary shadow-sm"
                : "border border-outline-variant/40 text-on-surface-variant hover:border-primary hover:text-primary"
            }`}
          >
            <Check size={14} weight={accepted ? "bold" : "regular"} />
            Accept
          </button>
          <button
            onClick={() => setBulletDecision("summary", "reject")}
            className={`flex items-center gap-xs px-md py-xs rounded-lg text-label-sm transition-all ${
              !accepted
                ? "bg-error text-on-error shadow-sm"
                : "border border-outline-variant/40 text-on-surface-variant hover:border-error hover:text-error"
            }`}
          >
            <X size={14} weight={!accepted ? "bold" : "regular"} />
            Keep original
          </button>
        </div>
      )}

      <div className="flex items-center gap-xs pt-xs border-t border-outline-variant/10 flex-wrap">
        <button
          disabled={!!loading}
          onClick={() => onRewrite("rewrite")}
          title="Re-optimize the summary for the JD"
          className="flex items-center gap-xs px-sm py-xs rounded-lg text-label-sm border border-outline-variant/40 text-on-surface-variant hover:border-secondary hover:text-secondary transition-all disabled:opacity-40"
        >
          <ArrowsClockwise size={13} className={loading === "rewrite" ? "animate-spin" : ""} />
          {loading === "rewrite" ? "Rewriting…" : "Rewrite for this JD"}
        </button>
        <button
          disabled={!!loading}
          onClick={() => onRewrite("humanize")}
          title="Make the summary sound more natural"
          className="flex items-center gap-xs px-sm py-xs rounded-lg text-label-sm border border-outline-variant/40 text-on-surface-variant hover:border-tertiary hover:text-tertiary transition-all disabled:opacity-40"
        >
          <Sparkle size={13} className={loading === "humanize" ? "animate-pulse" : ""} />
          {loading === "humanize" ? "Humanizing…" : "Humanize"}
        </button>
      </div>

      <div className="flex items-center gap-xs">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Or describe how you want it written — e.g. “lead with leadership, keep it under 60 words”"
          className="flex-1 px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          disabled={!!loading || !prompt.trim()}
          onClick={() => onRewrite("custom")}
          className="flex items-center gap-xs px-md py-xs rounded-lg text-label-sm text-on-primary bg-primary hover:bg-primary-container transition-all disabled:opacity-50"
        >
          {loading === "custom" ? "Rewriting…" : "Rewrite"}
        </button>
      </div>

      {error && <p className="text-caption text-error">{error}</p>}
    </div>
  );
}

// ── Suggested skills sub-component ───────────────────────────────────────────
// A skill is "Soft" if it names an interpersonal/behavioral trait rather
// than a tool, technology, or domain method — everything else defaults to
// "Technical". Deliberately the same kind of keyword heuristic as
// classifyTopic in the Interview Center (app/(app)/interview/page.tsx):
// no AI call, no backend change, cheap enough to run on every render.
const SOFT_SKILL_PATTERN =
  /leader|communicat|collaborat|team\s?work|team\s?player|problem[- ]?solv|adapt|time management|conflict|negotiat|mentor|coach|stakeholder engagement|presentation|interpersonal|critical thinking|creativity|emotional intelligence|work ethic|organi[sz]ational|flexibility|empath/i;

type SkillTier = "High" | "Medium" | "Low";

const TIER_DOT_CLASS: Record<SkillTier, string> = {
  High: "bg-error",
  Medium: "bg-tertiary",
  Low: "bg-on-surface-variant/40",
};

const IMPORTANCE_TIER: Record<ImportanceLevel, SkillTier> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function SkillsBlock({
  originalSkills,
  suggestedSkills,
  skillFixes,
  prioritySkills,
  missingSkills,
  companyKeywords,
  bulletDecisions,
  setBulletDecision,
  setFixDecision,
  refreshProjectedScore,
  applyBulletDecisions,
}: {
  originalSkills: string[];
  suggestedSkills: string[];
  skillFixes: AtsFix[];
  prioritySkills: string[];
  missingSkills: string[];
  companyKeywords: string[];
  bulletDecisions: Record<string, string>;
  setBulletDecision: (key: string, d: "accept" | "reject") => void;
  setFixDecision: (id: string, d: "accept" | "reject") => void;
  refreshProjectedScore: () => void;
  applyBulletDecisions: (decisions: Record<string, "accept" | "reject">) => void;
}) {
  if (originalSkills.length === 0 && suggestedSkills.length === 0 && skillFixes.length === 0) {
    return null;
  }
  const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
  const missingSet = new Set(missingSkills.map((s) => s.toLowerCase()));
  const keywordSet = new Set(companyKeywords.map((s) => s.toLowerCase()));

  // The unified "Skills to Add" candidates: JD-gap skill fixes first (they
  // carry their own importance + "+N%"), then plain AI suggestions. The caller
  // already stripped any suggestion whose name matches a fix, so no dupes.
  const fixByName = new Map(skillFixes.map((f) => [f.text.toLowerCase(), f]));
  const addCandidates = [...skillFixes.map((f) => f.text), ...suggestedSkills];

  // A candidate's accept/reject key: fix-backed skills flow through the same
  // `fix:${id}` decision + projected-score path the gap panel uses; plain
  // suggestions keep the legacy `skill_add:` key.
  const addKey = (skill: string) => {
    const fix = fixByName.get(skill.toLowerCase());
    return fix ? `fix:${fix.id}` : `skill_add:${skill}`;
  };
  const isAddSelected = (skill: string) => bulletDecisions[addKey(skill)] === "accept";

  // Both "which existing skills to keep" and "which suggested skills to
  // add" draw from the same MAX_MERGED_SKILLS budget — matches
  // buildMergedContent, so hitting the limit here reads as the same
  // guardrail the final resume will actually enforce, not a separate rule.
  const keepDefault = defaultSkillKeepDecision(originalSkills.length);
  const keptCount = originalSkills.filter(
    (s) => (bulletDecisions[`skill_keep:${s}`] ?? keepDefault) === "accept",
  ).length;
  const addedCount = addCandidates.filter(isAddSelected).length;
  const totalSelected = keptCount + addedCount;
  const atCap = totalSelected >= MAX_MERGED_SKILLS;

  // High = a real gap the JD asks for (or one you flagged yourself on the
  // JD page); Medium = not a gap, but a keyword this company's ATS scans
  // for; Low = a plausible AI suggestion (or existing skill) tied to
  // neither. Shown as a dot on suggested chips; also used to rank existing
  // skills for "Auto-select Top 20" below, even though it isn't displayed
  // there.
  function tierOf(skill: string): SkillTier {
    const fix = fixByName.get(skill.toLowerCase());
    if (fix) return IMPORTANCE_TIER[fix.importance];
    const l = skill.toLowerCase();
    if (prioritySet.has(l) || missingSet.has(l)) return "High";
    if (keywordSet.has(l)) return "Medium";
    return "Low";
  }

  // One-click best-fit selection — still fully an explicit, undoable user
  // action (never runs on its own), but picks the shared budget's contents
  // FOR the user instead of the fully manual, one-chip-at-a-time flow above.
  // Ranks every candidate (existing skills + suggestions) by tier, breaking
  // ties in favor of existing skills — they're already verified true about
  // the candidate, unlike a speculative AI suggestion — then takes the top
  // MAX_MERGED_SKILLS and sets every OTHER candidate to rejected, so this
  // is a full replace of the current selection, not just an addition.
  function handleAutoSelectTop() {
    const tierRank: Record<SkillTier, number> = { High: 0, Medium: 1, Low: 2 };
    const candidates = [
      ...originalSkills.map((skill) => ({ skill, isOriginal: true, tier: tierOf(skill) })),
      ...addCandidates.map((skill) => ({ skill, isOriginal: false, tier: tierOf(skill) })),
    ].sort((a, b) => {
      const byTier = tierRank[a.tier] - tierRank[b.tier];
      if (byTier !== 0) return byTier;
      return a.isOriginal === b.isOriginal ? 0 : a.isOriginal ? -1 : 1;
    });
    const top = new Set(candidates.slice(0, MAX_MERGED_SKILLS).map((c) => c.skill));

    const decisions: Record<string, "accept" | "reject"> = {};
    for (const skill of originalSkills) decisions[`skill_keep:${skill}`] = top.has(skill) ? "accept" : "reject";
    for (const skill of addCandidates) decisions[addKey(skill)] = top.has(skill) ? "accept" : "reject";
    applyBulletDecisions(decisions);
    // applyBulletDecisions doesn't re-score on its own — kick the projected total.
    refreshProjectedScore();
  }

  function renderKeepChip(skill: string) {
    const key = `skill_keep:${skill}`;
    const kept = (bulletDecisions[key] ?? keepDefault) === "accept";
    // Removing always frees a slot, so it's never blocked; only re-adding
    // (undoing a removal) can be blocked once the shared budget is spent.
    const disabled = !kept && atCap;
    return (
      <button
        key={skill}
        disabled={disabled}
        title={disabled ? `Skills limit reached (${MAX_MERGED_SKILLS}) — remove another to bring this back` : undefined}
        onClick={() => setBulletDecision(key, kept ? "reject" : "accept")}
        className={`flex items-center gap-xs px-sm py-xs pill rounded-full text-label-sm border transition-all ${
          kept
            ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30 font-medium"
            : disabled
            ? "bg-surface-container text-on-surface-variant/50 border-outline-variant/20 cursor-not-allowed"
            : "bg-error-container/25 text-on-error-container border-error/30 hover:border-error/60"
        }`}
      >
        {kept ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
        {skill}
      </button>
    );
  }

  function renderAddChip(skill: string) {
    const fix = fixByName.get(skill.toLowerCase());
    const key = addKey(skill);
    const selected = bulletDecisions[key] === "accept";
    const isPriority = prioritySet.has(skill.toLowerCase());
    const disabled = !selected && atCap;
    const tier = tierOf(skill);
    const toggle = () =>
      fix
        ? setFixDecision(fix.id, selected ? "reject" : "accept")
        : setBulletDecision(key, selected ? "reject" : "accept");
    return (
      <button
        key={skill}
        disabled={disabled}
        title={disabled ? `Skills limit reached (${MAX_MERGED_SKILLS}) — deselect another to add this one` : `${tier} priority`}
        onClick={toggle}
        className={`flex items-center gap-xs px-sm py-xs pill rounded-full text-label-sm border transition-all ${
          selected
            ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30 font-medium"
            : disabled
            ? "bg-surface-container text-on-surface-variant/50 border-outline-variant/20 cursor-not-allowed"
            : "bg-error-container/25 text-on-error-container border-error/30 hover:border-error/60"
        }`}
      >
        {selected ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT_CLASS[tier]}`} />
        {isPriority && <span aria-label="You picked this keyword">★</span>}
        {skill}
        {fix && fix.score_delta > 0 && (
          <span className="text-primary font-semibold">+{fix.score_delta}%</span>
        )}
      </button>
    );
  }

  const originalTechnical = originalSkills.filter((s) => !SOFT_SKILL_PATTERN.test(s));
  const originalSoft = originalSkills.filter((s) => SOFT_SKILL_PATTERN.test(s));
  const suggestedTechnical = addCandidates.filter((s) => !SOFT_SKILL_PATTERN.test(s));
  const suggestedSoft = addCandidates.filter((s) => SOFT_SKILL_PATTERN.test(s));

  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-md">
      <div>
        <div className="flex items-start justify-between gap-sm">
          <p className="text-label-sm text-on-surface font-bold">Skills</p>
          <button
            type="button"
            onClick={handleAutoSelectTop}
            title="Ranks every current + suggested skill by fit for this JD and selects the top ones — you can still adjust any pick afterward"
            className="shrink-0 flex items-center gap-xs px-sm py-xs rounded-lg text-caption text-primary border border-primary/30 hover:bg-primary/5 transition-colors"
          >
            <Target size={13} />
            Auto-select Top {MAX_MERGED_SKILLS} for this JD
          </button>
        </div>
        <p className="text-caption text-on-surface-variant">
          {originalSkills.length > MAX_MERGED_SKILLS ? (
            <>
              Your resume has {originalSkills.length} skills — only {MAX_MERGED_SKILLS} can go on the tailored
              version. None are kept automatically; select which ones matter most for this JD below.
            </>
          ) : (
            "Click a suggested skill to add it — nothing is added automatically."
          )}
        </p>
        <p className="text-caption text-on-surface-variant flex items-center gap-sm flex-wrap">
          <span>
            {totalSelected} / {MAX_MERGED_SKILLS} selected
            {atCap && " — limit reached, deselect one to select another"}
          </span>
          {addCandidates.length > 0 && (
            <span className="flex items-center gap-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_CLASS.High}`} /> High
              <span className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_CLASS.Medium}`} /> Medium
              <span className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_CLASS.Low}`} /> Low
            </span>
          )}
        </p>
      </div>

      {originalSkills.length > 0 && (
        <div className="flex flex-col gap-sm">
          <p className="text-label-sm text-on-surface font-bold">Your Current Skills</p>
          {originalTechnical.length > 0 && (
            <div className="flex flex-col gap-xs">
              <p className="text-caption text-on-surface-variant font-bold uppercase tracking-wider">Technical</p>
              <div className="flex flex-wrap gap-xs">{originalTechnical.map(renderKeepChip)}</div>
            </div>
          )}
          {originalSoft.length > 0 && (
            <div className="flex flex-col gap-xs">
              <p className="text-caption text-on-surface-variant font-bold uppercase tracking-wider">Soft Skills</p>
              <div className="flex flex-wrap gap-xs">{originalSoft.map(renderKeepChip)}</div>
            </div>
          )}
        </div>
      )}

      {addCandidates.length > 0 && (
        <div className="flex flex-col gap-sm">
          <p className="text-label-sm text-on-surface font-bold">
            Skills to Add for this JD
            {prioritySkills.length > 0 && (
              <span className="font-normal text-caption text-on-surface-variant"> — ★ marks the keywords you picked on the JD page</span>
            )}
          </p>
          {suggestedTechnical.length > 0 && (
            <div className="flex flex-col gap-xs">
              <p className="text-caption text-on-surface-variant font-bold uppercase tracking-wider">Technical</p>
              <div className="flex flex-wrap gap-xs">{suggestedTechnical.map(renderAddChip)}</div>
            </div>
          )}
          {suggestedSoft.length > 0 && (
            <div className="flex flex-col gap-xs">
              <p className="text-caption text-on-surface-variant font-bold uppercase tracking-wider">Soft Skills</p>
              <div className="flex flex-wrap gap-xs">{suggestedSoft.map(renderAddChip)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
