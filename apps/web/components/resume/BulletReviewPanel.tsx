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
} from "@phosphor-icons/react";
import { useTailoringStore, type BulletChange, MAX_MERGED_SKILLS } from "@/stores/tailoring-store";
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
  const missingSkills = useTailoringStore((s) => s.missingSkills);
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

  const originalSkillsCount = originalContent?.skills.length ?? 0;

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
          missingSkills={missingSkills}
          companyKeywords={companyKeywords}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
          originalSkillsCount={originalContent?.skills.length ?? 0}
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
          missingSkills={missingSkills}
          companyKeywords={companyKeywords}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
          originalSkillsCount={originalContent?.skills.length ?? 0}
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

function SkillsBlock({
  suggestedSkills,
  prioritySkills,
  missingSkills,
  companyKeywords,
  bulletDecisions,
  setBulletDecision,
  originalSkillsCount,
}: {
  suggestedSkills: string[];
  prioritySkills: string[];
  missingSkills: string[];
  companyKeywords: string[];
  bulletDecisions: Record<string, string>;
  setBulletDecision: (key: string, d: "accept" | "reject") => void;
  originalSkillsCount: number;
}) {
  if (suggestedSkills.length === 0) return null;
  const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
  const missingSet = new Set(missingSkills.map((s) => s.toLowerCase()));
  const keywordSet = new Set(companyKeywords.map((s) => s.toLowerCase()));
  const selectedCount = suggestedSkills.filter(
    (s) => bulletDecisions[`skill_add:${s}`] === "accept",
  ).length;
  // Mirrors buildMergedContent's cap — surfaced here so hitting the limit
  // reads as an intentional guardrail, not skills silently failing to add.
  const remainingSlots = Math.max(0, MAX_MERGED_SKILLS - originalSkillsCount - selectedCount);
  const atCap = remainingSlots === 0;

  // High = a real gap the JD asks for (or one you flagged yourself on the
  // JD page); Medium = not a gap, but a keyword this company's ATS scans
  // for; Low = a plausible AI suggestion tied to neither.
  function tierOf(skill: string): SkillTier {
    const l = skill.toLowerCase();
    if (prioritySet.has(l) || missingSet.has(l)) return "High";
    if (keywordSet.has(l)) return "Medium";
    return "Low";
  }

  const technicalSkills = suggestedSkills.filter((s) => !SOFT_SKILL_PATTERN.test(s));
  const softSkills = suggestedSkills.filter((s) => SOFT_SKILL_PATTERN.test(s));

  function renderChip(skill: string) {
    const selected = bulletDecisions[`skill_add:${skill}`] === "accept";
    const isPriority = prioritySet.has(skill.toLowerCase());
    const disabled = !selected && atCap;
    const tier = tierOf(skill);
    return (
      <button
        key={skill}
        disabled={disabled}
        title={disabled ? `Skills limit reached (${MAX_MERGED_SKILLS}) — deselect another to add this one` : `${tier} priority`}
        onClick={() =>
          setBulletDecision(
            `skill_add:${skill}`,
            selected ? "reject" : "accept",
          )
        }
        className={`flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
          selected
            ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30 font-medium"
            : disabled
            ? "bg-surface-container text-on-surface-variant/50 border-outline-variant/20 cursor-not-allowed"
            : "bg-error-container/25 text-on-error-container border-error/30 hover:border-error/60"
        }`}
      >
        {selected ? (
          <Check size={11} weight="bold" />
        ) : (
          <X size={11} weight="bold" />
        )}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT_CLASS[tier]}`} />
        {isPriority && <span aria-label="You picked this keyword">★</span>}
        {skill}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-sm">
      <div>
        <p className="text-label-sm text-on-surface font-bold">Suggested Skills to Add</p>
        <p className="text-caption text-on-surface-variant">
          Click a skill to include it — nothing is added automatically.
          {prioritySkills.length > 0 && " ★ marks the keywords you picked on the JD page."}
        </p>
        <p className="text-caption text-on-surface-variant flex items-center gap-sm flex-wrap">
          <span>
            {originalSkillsCount + selectedCount} / {MAX_MERGED_SKILLS} skills
            {atCap && " — limit reached, deselect one to add another"}
          </span>
          <span className="flex items-center gap-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_CLASS.High}`} /> High
            <span className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_CLASS.Medium}`} /> Medium
            <span className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_CLASS.Low}`} /> Low
          </span>
        </p>
      </div>
      {technicalSkills.length > 0 && (
        <div className="flex flex-col gap-xs">
          <p className="text-caption text-on-surface-variant font-bold uppercase tracking-wider">Technical</p>
          <div className="flex flex-wrap gap-xs">{technicalSkills.map(renderChip)}</div>
        </div>
      )}
      {softSkills.length > 0 && (
        <div className="flex flex-col gap-xs">
          <p className="text-caption text-on-surface-variant font-bold uppercase tracking-wider">Soft Skills</p>
          <div className="flex flex-wrap gap-xs">{softSkills.map(renderChip)}</div>
        </div>
      )}
    </div>
  );
}
