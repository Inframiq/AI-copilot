"use client";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore, deriveBulletChanges, type BulletChange } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { SummaryCard } from "@/components/studio/review/SummaryCard";
import { TriageDeck } from "@/components/studio/review/TriageDeck";
import { SkillsCard } from "@/components/studio/review/SkillsCard";
import { FactLockNotice } from "@/components/studio/review/FactLockNotice";
import { SourcePanel } from "@/components/studio/canvas/SourcePanel";
import { FOCUS_RING } from "@/lib/focus";

/**
 * The tailoring review: the whole of the JD path between "Tailor Resume" and
 * the Studio.
 *
 * Its handlers are ported from the deleted StudioShell, which was the only
 * thing that rendered TriageDeck and SkillsCard — removing it left the
 * review orphaned and the JD path with nothing to review. The components
 * themselves are unchanged; this is the wiring they lost.
 *
 * Deliberately not the Builder's six sections: arriving from the JD Analyzer
 * you have already said what you want, and being walked through Contact and
 * Education first is work you did not ask for.
 */
export function ReviewShell({
  onBack,
  onApply,
}: {
  onBack: () => void;
  onApply: () => void;
}) {
  const originalContent = useResumeStore((s) => s.content);

  const pendingContent = useTailoringStore((s) => s.pendingContent);
  const bulletDecisions = useTailoringStore((s) => s.bulletDecisions);
  const setBulletDecision = useTailoringStore((s) => s.setBulletDecision);
  const setAllBulletDecisions = useTailoringStore((s) => s.setAllBulletDecisions);
  const applyBulletDecisions = useTailoringStore((s) => s.applyBulletDecisions);
  const updatePendingBullet = useTailoringStore((s) => s.updatePendingBullet);
  const updatePendingSummary = useTailoringStore((s) => s.updatePendingSummary);
  const setFixDecision = useTailoringStore((s) => s.setFixDecision);
  const refreshProjectedScore = useTailoringStore((s) => s.refreshProjectedScore);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const atsScoreBefore = useTailoringStore((s) => s.atsScoreBefore);
  const projectedAtsScore = useTailoringStore((s) => s.projectedAtsScore);
  const suggestedSkills = useTailoringStore((s) => s.suggestedSkills);
  const prioritySkills = useTailoringStore((s) => s.prioritySkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const companyKeywords = useTailoringStore((s) => s.companyKeywords);
  const bulletImportance = useTailoringStore((s) => s.bulletImportance);
  const bulletRationale = useTailoringStore((s) => s.bulletRationale);
  const revertedBullets = useTailoringStore((s) => s.revertedBullets);
  const atsFixes = useTailoringStore((s) => s.atsFixes);
  const humanizeLevel = useTailoringStore((s) => s.humanizeLevel);
  const jdText = useTailoringStore((s) => s.jdText);
  const jdId = useTailoringStore((s) => s.jdId);
  const isLoading = useTailoringStore((s) => s.isLoading);
  const hasJd = !!jdId || !!jdText.trim();
  const error = useTailoringStore((s) => s.error);

  const [bulletLoading, setBulletLoading] = useState<Record<string, "rewrite" | "humanize" | null>>({});
  const [rewriteReverted, setRewriteReverted] = useState<Record<string, string[]>>({});
  const [summaryLoading, setSummaryLoading] = useState<"rewrite" | "humanize" | "custom" | null>(null);
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Subscribed, not read via getState(): SourcePanel creates the JD row and
  // sets jdId, and this must re-render when it does.

  const bulletChanges = useMemo<BulletChange[]>(
    () => deriveBulletChanges(pendingContent, originalContent),
    [pendingContent, originalContent],
  );

  // JD-gap skills come through as `type:"skill"` fixes and render inside the
  // single SkillsCard, so drop any plain suggestion with the same name —
  // each skill is chosen once.
  const skillFixes = useMemo(() => atsFixes.filter((f) => f.type === "skill"), [atsFixes]);
  const dedupedSuggestedSkills = useMemo(() => {
    const taken = new Set(skillFixes.map((f) => f.text.toLowerCase()));
    return suggestedSkills.filter((s) => !taken.has(s.toLowerCase()));
  }, [suggestedSkills, skillFixes]);

  async function handleRewriteBullet(change: BulletChange, mode: "rewrite" | "humanize") {
    setBulletLoading((prev) => ({ ...prev, [change.key]: mode }));
    try {
      const { rewritten_text, reverted_reasons } = await apiClient.rewriteBullet({
        bullet_text: change.tailored,
        mode,
        jd_context: mode === "rewrite" ? jdText : undefined,
        humanize_level: humanizeLevel,
      });
      // The server's fact-lock hands back the ORIGINAL when it rejects a
      // rewrite. Say so — otherwise the button looks broken.
      setRewriteReverted((prev) => ({ ...prev, [change.key]: reverted_reasons ?? [] }));
      updatePendingBullet(change.key, rewritten_text);
      setBulletDecision(change.key, "accept");
    } catch {
      // silently fail — the original tailored text stays
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
      setBulletDecision("summary", "accept");
      if (mode === "custom") setSummaryPrompt("");
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setSummaryLoading(null);
    }
  }

  function handleApply() {
    applyBulletDecisions(bulletDecisions as Record<string, "accept" | "reject">);
    onApply();
  }

  const before = atsScoreBefore ?? atsScore;
  const after = projectedAtsScore ?? atsScore;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-lg border-b border-outline-variant/30 bg-surface px-lg py-md">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Analyzer"
          className={`flex shrink-0 items-center gap-xs rounded-lg text-label-md text-on-surface-variant transition-colors hover:text-on-surface ${FOCUS_RING}`}
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Back to Analyzer</span>
        </button>
        <span aria-hidden className="h-4 w-px shrink-0 bg-outline-variant/40" />
        <h1 className="truncate text-headline-md font-semibold text-on-surface">
          {hasJd ? "Review your tailored résumé" : "Tailor this résumé"}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-lg py-xl">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-xl">
          {/* Path B's entry, orphaned by the same deletion that took the
              review: with no JD chosen there is nothing to review yet, and
              this is where you paste one. SourcePanel calls runTailoring
              itself, so the review appears here when it returns. */}
          {!hasJd && !isLoading && <SourcePanel />}

          {isLoading && (
            <div className="flex flex-col items-center gap-sm rounded-2xl border border-dashed border-outline-variant/40 px-lg py-xxl text-center">
              <Sparkle size={28} className="animate-pulse text-primary" />
              <p className="text-label-md font-semibold text-on-surface">
                Tailoring your résumé
              </p>
              <p className="max-w-sm text-caption text-on-surface-variant">
                Reading the job description, then rewriting only the bullets that can
                honestly speak to it.
              </p>
            </div>
          )}

          {error && !isLoading && (
            <p
              role="alert"
              className="flex items-center gap-xs rounded-xl bg-error-container px-md py-sm text-caption text-on-error-container"
            >
              <WarningCircle size={14} weight="fill" />
              {error}
            </p>
          )}

          {pendingContent && (
            <>
              {before !== null && after !== null && (
                <section className="flex items-center justify-center gap-lg rounded-2xl border border-outline-variant/30 bg-surface p-lg">
                  <div className="flex flex-col items-center gap-xs">
                    <ScoreRing score={before} size={72} />
                    <span className="text-caption text-on-surface-variant">Before</span>
                  </div>
                  <ArrowRight size={20} className="text-on-surface-variant" />
                  <div className="flex flex-col items-center gap-xs">
                    <ScoreRing score={after} size={72} />
                    <span className="text-caption text-on-surface-variant">
                      With your choices
                    </span>
                  </div>
                </section>
              )}

              {/* A fact-locked bullet never enters the queue, so this is the
                  only place it can be reported. */}
              <FactLockNotice reverted={revertedBullets} />

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
                rationale={bulletRationale}
                revertedReasons={rewriteReverted}
                busy={bulletLoading}
                onDecide={setBulletDecision}
                onRewrite={handleRewriteBullet}
                onEdit={(change, text) => updatePendingBullet(change.key, text)}
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
            </>
          )}
        </div>
      </div>

      {pendingContent && (
        <div className="flex shrink-0 items-center justify-end gap-md border-t border-outline-variant/30 bg-surface px-lg py-md">
          <button
            type="button"
            onClick={handleApply}
            className={`flex items-center gap-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary transition-opacity hover:opacity-90 ${FOCUS_RING}`}
          >
            Apply &amp; Preview
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
