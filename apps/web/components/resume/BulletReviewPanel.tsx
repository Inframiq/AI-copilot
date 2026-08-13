"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
} from "@phosphor-icons/react";
import { useTailoringStore, type BulletChange } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient } from "@/lib/api-client";

export function BulletReviewPanel() {
  const router = useRouter();
  const pendingContent = useTailoringStore((s) => s.pendingContent);
  const bulletDecisions = useTailoringStore((s) => s.bulletDecisions);
  const setBulletDecision = useTailoringStore((s) => s.setBulletDecision);
  const setAllBulletDecisions = useTailoringStore((s) => s.setAllBulletDecisions);
  const updatePendingBullet = useTailoringStore((s) => s.updatePendingBullet);
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
  // Shown on Preview Tailored Resume only if the user never touched any
  // suggested-skill chip — an explicit choice (even a single click) is
  // respected as-is, no prompt.
  const [showSkillsPrompt, setShowSkillsPrompt] = useState(false);
  // Per-bullet loading: key → "rewrite" | "humanize" | null
  const [bulletLoading, setBulletLoading] = useState<Record<string, "rewrite" | "humanize" | null>>({});
  // Portal target readiness — document.body isn't available during SSR, and
  // this panel's own ancestors (the page-transition wrapper's will-change/
  // transform) turn "fixed" into "fixed relative to that ancestor" instead of
  // the viewport, which is why this dialog was rendering clipped to the
  // editor pane instead of covering the whole screen (PDF preview bleeding
  // through). Portaling to <body> escapes that ancestor chain entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  // Entry point for the "Preview Tailored Resume" button — interposes the
  // top-15-skills prompt when nothing was explicitly decided.
  function handlePreviewClick() {
    const anySkillDecided = suggestedSkills.some((s) => `skill_add:${s}` in bulletDecisions);
    if (suggestedSkills.length > 0 && !anySkillDecided) {
      setShowSkillsPrompt(true);
      return;
    }
    handleGeneratePreview();
  }

  function acceptTopSkills() {
    // AI orders plausible_skills_to_add most-important-first (see Agent 2's
    // prompt) — "top 15" is just the first 15 of that ranked list.
    for (const skill of suggestedSkills.slice(0, 15)) {
      setBulletDecision(`skill_add:${skill}`, "accept");
    }
    setShowSkillsPrompt(false);
    handleGeneratePreview();
  }

  function skipSuggestedSkills() {
    setShowSkillsPrompt(false);
    handleGeneratePreview();
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
        {/* Skills + generate still shown */}
        <SkillsBlock
          suggestedSkills={suggestedSkills}
          prioritySkills={prioritySkills}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
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
            {atsScore !== null && ` · ATS Score: ${atsScore}%`}
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
                className="px-sm py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium border border-primary/20"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

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

        {/* 1. Suggested skills */}
        <SkillsBlock
          suggestedSkills={suggestedSkills}
          prioritySkills={prioritySkills}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
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
              onClick={handlePreviewClick}
              disabled={isApplying || isGenerating || !resumeId}
              className="w-full flex items-center justify-center gap-sm py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
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
                className="flex-1 flex items-center justify-center gap-xs py-sm rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg transition-all"
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

      {/* Shown once, only when no suggested skill was ever clicked before
          previewing — an explicit pick (even one) skips this entirely.
          Portaled to <body> so it always covers the full viewport — nested
          under the page-transition wrapper's animation styles, "fixed"
          here would otherwise be positioned relative to an ancestor instead
          of the viewport, rendering clipped behind the PDF preview pane. */}
      {showSkillsPrompt && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-gutter">
          <div className="relative bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl p-xl max-w-[26rem] w-full flex flex-col items-center text-center gap-md">
            <button
              onClick={skipSuggestedSkills}
              aria-label="Close"
              className="absolute top-md right-md p-xs rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              <X size={18} />
            </button>
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkle size={28} className="text-primary" />
            </div>
            <div>
              <p className="text-headline-md text-on-surface font-bold mb-xs">Add suggested skills?</p>
              <p className="text-body-sm text-on-surface-variant">
                You haven&apos;t picked any of the {suggestedSkills.length} suggested skills above. Want AI to add
                the top {Math.min(15, suggestedSkills.length)} it thinks best match this JD? Otherwise your
                resume&apos;s original skills are used as-is.
              </p>
            </div>
            <div className="flex gap-sm w-full">
              <button
                onClick={skipSuggestedSkills}
                className="flex-1 py-sm rounded-xl text-label-md text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors"
              >
                Keep original skills
              </button>
              <button
                onClick={acceptTopSkills}
                className="flex-1 py-sm rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg transition-all"
              >
                Add top {Math.min(15, suggestedSkills.length)}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Suggested skills sub-component ───────────────────────────────────────────
function SkillsBlock({
  suggestedSkills,
  prioritySkills,
  bulletDecisions,
  setBulletDecision,
}: {
  suggestedSkills: string[];
  prioritySkills: string[];
  bulletDecisions: Record<string, string>;
  setBulletDecision: (key: string, d: "accept" | "reject") => void;
}) {
  if (suggestedSkills.length === 0) return null;
  const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-sm">
      <div>
        <p className="text-label-sm text-on-surface font-bold">Suggested Skills to Add</p>
        <p className="text-caption text-on-surface-variant">
          Click a skill to include it in your resume
          {prioritySkills.length > 0 && " — ★ marks the keywords you picked on the JD page"}
        </p>
      </div>
      <div className="flex flex-wrap gap-xs">
        {suggestedSkills.map((skill) => {
          const selected = bulletDecisions[`skill_add:${skill}`] === "accept";
          const isPriority = prioritySet.has(skill.toLowerCase());
          return (
            <button
              key={skill}
              onClick={() =>
                setBulletDecision(
                  `skill_add:${skill}`,
                  selected ? "reject" : "accept",
                )
              }
              className={`flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
                selected
                  ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30 font-medium"
                  : "bg-error-container/25 text-on-error-container border-error/30 hover:border-error/60"
              }`}
            >
              {selected ? (
                <Check size={11} weight="bold" />
              ) : (
                <X size={11} weight="bold" />
              )}
              {isPriority && <span aria-label="You picked this keyword">★</span>}
              {skill}
            </button>
          );
        })}
      </div>
    </div>
  );
}
