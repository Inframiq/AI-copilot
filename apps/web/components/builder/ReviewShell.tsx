"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowsClockwise, WarningCircle } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore, deriveBulletChanges, type BulletChange } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";
import { SummaryCard } from "@/components/studio/review/SummaryCard";
import {
  PointsLedger,
  autoSelectDecisions,
  clearDecisions,
  countPointsOn,
} from "@/components/studio/review/PointsLedger";
import { SkillsCard } from "@/components/studio/review/SkillsCard";
import { ScoreRail, ScoreDock, type ScoreRailProps } from "@/components/studio/review/ScoreRail";
import { SourcePanel } from "@/components/studio/canvas/SourcePanel";
import { TailoringStar } from "./TailoringStar";
import { FOCUS_RING, PRESS } from "@/lib/focus";

/**
 * The tailoring review: the whole of the JD path between "Tailor Resume" and
 * the Studio.
 *
 * Laid out as a cockpit: on desktop a sticky rail keeps the live score and
 * the Apply button in view while you work through the points; on phones the
 * same answer is pinned to the bottom edge. The points are reviewed in
 * PointsLedger, grouped by where each came from — reworded, adds a JD term,
 * or written by AI — because whether a point is safe to accept depends on
 * exactly that.
 *
 * Deliberately not the Builder's six sections: arriving from the JD Analyzer
 * you have already said what you want, and being walked through Contact and
 * Education first is work you did not ask for.
 */
export function ReviewShell({
  onBack,
  onApply,
  onTryAnother,
  onRetry,
}: {
  onBack: () => void;
  onApply: () => void;
  /** Re-run tailoring for new wording, skipping reuse of the identical run. */
  onTryAnother: () => void;
  /** Run tailoring again after it failed. */
  onRetry: () => void;
}) {
  const originalContent = useResumeStore((s) => s.content);

  const pendingContent = useTailoringStore((s) => s.pendingContent);
  const bulletDecisions = useTailoringStore((s) => s.bulletDecisions);
  const setBulletDecision = useTailoringStore((s) => s.setBulletDecision);
  const applyBulletDecisions = useTailoringStore((s) => s.applyBulletDecisions);
  const updatePendingBullet = useTailoringStore((s) => s.updatePendingBullet);
  const updatePendingSummary = useTailoringStore((s) => s.updatePendingSummary);
  const setFixDecision = useTailoringStore((s) => s.setFixDecision);
  const setFixExperienceIndex = useTailoringStore((s) => s.setFixExperienceIndex);
  const fixExperienceIndex = useTailoringStore((s) => s.fixExperienceIndex);
  const reusedRun = useTailoringStore((s) => s.reusedRun);
  const refreshProjectedScore = useTailoringStore((s) => s.refreshProjectedScore);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const atsScoreBefore = useTailoringStore((s) => s.atsScoreBefore);
  const projectedAtsScore = useTailoringStore((s) => s.projectedAtsScore);
  const projectedScoreStale = useTailoringStore((s) => s.projectedScoreStale);
  const isProjecting = useTailoringStore((s) => s.isProjecting);
  const suggestedSkills = useTailoringStore((s) => s.suggestedSkills);
  const matchedSkills = useTailoringStore((s) => s.matchedSkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const bulletRationale = useTailoringStore((s) => s.bulletRationale);
  const revertedBullets = useTailoringStore((s) => s.revertedBullets);
  const atsFixes = useTailoringStore((s) => s.atsFixes);
  const humanizeLevel = useTailoringStore((s) => s.humanizeLevel);
  // Subscribed, not read via getState(): SourcePanel creates the JD row and
  // sets jdId, and this must re-render when it does.
  const jdText = useTailoringStore((s) => s.jdText);
  const jdId = useTailoringStore((s) => s.jdId);
  const isLoading = useTailoringStore((s) => s.isLoading);
  const hasJd = !!jdId || !!jdText.trim();
  const error = useTailoringStore((s) => s.error);

  const [bulletLoading, setBulletLoading] = useState<Record<string, "rewrite" | "humanize" | null>>({});
  const [rewriteReverted, setRewriteReverted] = useState<Record<string, string[]>>({});
  const [rewriteErrors, setRewriteErrors] = useState<Record<string, string>>({});
  const [summaryLoading, setSummaryLoading] = useState<"rewrite" | "humanize" | "custom" | null>(null);
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const bulletChanges = useMemo<BulletChange[]>(
    () => deriveBulletChanges(pendingContent, originalContent),
    [pendingContent, originalContent],
  );
  // Every phrase the JD is scored on: what "adds a JD term" is checked against.
  const jdTerms = useMemo(() => [...matchedSkills, ...missingSkills], [matchedSkills, missingSkills]);

  // JD-gap skills come through as `type:"skill"` fixes and render inside the
  // single SkillsCard, so drop any plain suggestion with the same name —
  // each skill is chosen once.
  const skillFixes = useMemo(() => atsFixes.filter((f) => f.type === "skill"), [atsFixes]);
  // New bullets and the headline are text the AI wrote from nothing — they
  // are reviewed as points, not as skills.
  const aiFixes = useMemo(() => atsFixes.filter((f) => f.type !== "skill"), [atsFixes]);
  const roles = useMemo(
    () =>
      (pendingContent?.experience ?? []).map((e) =>
        [e.title, e.company].filter(Boolean).join(" · ") || "Untitled role",
      ),
    [pendingContent],
  );
  const dedupedSuggestedSkills = useMemo(() => {
    const taken = new Set(skillFixes.map((f) => f.text.toLowerCase()));
    return suggestedSkills.filter((s) => !taken.has(s.toLowerCase()));
  }, [suggestedSkills, skillFixes]);

  async function handleRewriteBullet(change: BulletChange, mode: "rewrite" | "humanize") {
    setBulletLoading((prev) => ({ ...prev, [change.key]: mode }));
    setRewriteErrors((prev) => {
      const next = { ...prev };
      delete next[change.key];
      return next;
    });
    try {
      const { rewritten_text, reverted_reasons } = await apiClient.rewriteBullet({
        bullet_text: change.tailored,
        mode,
        jd_context: mode === "rewrite" ? jdText : undefined,
        humanize_level: humanizeLevel,
      });
      // The server's fact-lock hands back the text it was given when it
      // rejects a rewrite. Say so — otherwise the button looks broken.
      setRewriteReverted((prev) => ({ ...prev, [change.key]: reverted_reasons ?? [] }));
      updatePendingBullet(change.key, rewritten_text);
      setBulletDecision(change.key, "accept");
      // A rewrite spends a credit — keep the meter honest.
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    } catch (err) {
      // Used to be swallowed: the button spun, then nothing — the most
      // "unresponsive" thing on the screen. Say what happened instead.
      const message = err instanceof Error ? err.message : "";
      setRewriteErrors((prev) => ({
        ...prev,
        [change.key]: `Couldn't ${mode} this point${message ? ` — ${message}` : ""}. Your text is unchanged; try again.`,
      }));
    } finally {
      setBulletLoading((prev) => ({ ...prev, [change.key]: null }));
    }
  }

  async function handleRewriteSummary(mode: "rewrite" | "humanize" | "custom") {
    const currentSummary = (pendingContent?.summary || originalContent?.summary || "").trim();
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
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      if (mode === "custom") setSummaryPrompt("");
    } catch (err) {
      setSummaryError(
        `Couldn't rewrite the summary${err instanceof Error && err.message ? ` — ${err.message}` : ""}. Your text is unchanged; try again.`,
      );
    } finally {
      setSummaryLoading(null);
    }
  }

  function handleApply() {
    // Recording the decisions is not enough: the Studio renders resume-store,
    // so the merged résumé has to be written there or it shows the original.
    if (!useTailoringStore.getState().commitReview()) return;
    onApply();
  }

  const before = atsScoreBefore ?? atsScore;
  const after = projectedAtsScore ?? atsScore;
  const skillsAdded =
    skillFixes.filter((f) => bulletDecisions[`fix:${f.id}`] === "accept").length +
    dedupedSuggestedSkills.filter((s) => bulletDecisions[`skill_add:${s}`] === "accept").length;

  const rail: ScoreRailProps = {
    before,
    after,
    updating: isProjecting,
    stale: projectedScoreStale,
    onRetryScore: refreshProjectedScore,
    pointsOn: countPointsOn(bulletChanges, aiFixes, bulletDecisions),
    pointsTotal: bulletChanges.length + aiFixes.length,
    skillsAdded,
    onAutoSelect: () => applyBulletDecisions(autoSelectDecisions(bulletChanges)),
    onClear: () => applyBulletDecisions(clearDecisions(bulletChanges, aiFixes)),
    onApply: handleApply,
    canApply: !!pendingContent && !!originalContent,
    onTryAnother,
    reusedRun,
  };
  const reviewing = !!pendingContent && !isLoading;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-md border-b border-outline-variant/30 bg-surface px-md py-sm sm:gap-lg sm:px-lg sm:py-md">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Analyzer"
          className={`flex shrink-0 items-center gap-xs rounded-xl px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-container hover:text-on-surface active:bg-surface-container-high ${PRESS} ${FOCUS_RING}`}
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Back to Analyzer</span>
        </button>
        <span aria-hidden className="h-4 w-px shrink-0 bg-outline-variant/40" />
        <h1 className="truncate text-body-lg font-semibold text-on-surface sm:text-headline-md">
          {hasJd ? "Review your tailored résumé" : "Tailor this résumé"}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div
          className={`mx-auto grid w-full gap-xl px-md py-lg sm:px-lg lg:py-xl ${
            reviewing ? "max-w-6xl lg:grid-cols-[300px_minmax(0,1fr)]" : "max-w-3xl"
          }`}
        >
          {reviewing && (
            <aside className="hidden lg:block">
              <div className="sticky top-0">
                <ScoreRail {...rail} />
              </div>
            </aside>
          )}

          <main className="flex min-w-0 flex-col gap-xl">
            {/* Path B's entry: with no JD chosen there is nothing to review
                yet, and this is where you paste one. SourcePanel calls
                runTailoring itself, so the review appears here when it
                returns. */}
            {!hasJd && !isLoading && <SourcePanel />}

            {isLoading && <TailoringProgress />}

            {error && !isLoading && (
              <div
                role="alert"
                className="flex flex-col gap-sm rounded-3xl border border-error/30 bg-error-container/60 p-lg sm:flex-row sm:items-center"
              >
                <WarningCircle size={22} weight="fill" className="shrink-0 text-error" />
                <p className="flex-1 text-body-md text-on-error-container">{error}</p>
                {hasJd && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className={`flex shrink-0 items-center justify-center gap-xs rounded-xl bg-error px-md py-sm text-label-md font-semibold text-on-error active:brightness-90 ${PRESS} ${FOCUS_RING}`}
                  >
                    <ArrowsClockwise size={16} /> Try again
                  </button>
                )}
              </div>
            )}

            {reviewing && (
              <>
                {originalContent && (
                  <PointsLedger
                    changes={bulletChanges}
                    decisions={bulletDecisions as Record<string, "accept" | "reject">}
                    rationale={bulletRationale}
                    original={originalContent}
                    jdTerms={jdTerms}
                    aiFixes={aiFixes}
                    roles={roles}
                    fixExperienceIndex={fixExperienceIndex}
                    reverted={revertedBullets}
                    busy={bulletLoading}
                    rewriteErrors={rewriteErrors}
                    revertedReasons={rewriteReverted}
                    bulkActionsClassName="lg:hidden"
                    onDecide={setBulletDecision}
                    onBulk={applyBulletDecisions}
                    onFixDecide={setFixDecision}
                    onFixRole={setFixExperienceIndex}
                    onRewrite={handleRewriteBullet}
                    onEdit={(change, text) => updatePendingBullet(change.key, text)}
                  />
                )}

                <SkillsCard
                  originalSkills={originalContent?.skills ?? []}
                  suggestedSkills={dedupedSuggestedSkills}
                  skillFixes={skillFixes}
                  matchedSkills={matchedSkills}
                  decisions={bulletDecisions}
                  onDecide={setBulletDecision}
                  onFixDecision={setFixDecision}
                  onApply={applyBulletDecisions}
                />

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
              </>
            )}
          </main>
        </div>
      </div>

      {reviewing && (
        <footer className="shrink-0 border-t border-outline-variant/30 bg-surface/95 px-md py-sm backdrop-blur lg:hidden">
          <ScoreDock {...rail} />
        </footer>
      )}
    </div>
  );
}

/**
 * While the pipeline runs (typically 30–90 s). Honest about what it is
 * doing and for how long, without pretending to know which step it is on.
 */
function TailoringProgress() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const steps = [
    "Reading the job description",
    "Matching it to your experience",
    "Rewriting the bullets that can honestly speak to it",
    "Fact-checking every rewrite",
    "Scoring the result",
  ];
  return (
    <div className="flex flex-col gap-lg" aria-busy="true">
      <div className="flex flex-col items-center gap-sm rounded-3xl border border-outline-variant/30 bg-surface-container-lowest px-lg py-xl text-center shadow-sm">
        <TailoringStar />
        <p className="text-body-lg font-semibold text-on-surface">Tailoring your résumé</p>
        <p className="tabular text-caption text-on-surface-variant">
          {seconds}s · usually 30–90 seconds
        </p>
        <ul className="mt-sm flex flex-col gap-1 text-left text-body-sm text-on-surface-variant">
          {steps.map((s) => (
            <li key={s} className="flex items-center gap-sm">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary/50" />
              {s}
            </li>
          ))}
        </ul>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden className="flex flex-col gap-sm rounded-3xl border border-outline-variant/20 p-lg">
          <div className="skeleton h-4 w-40 rounded-full" />
          <div className="skeleton h-4 w-full rounded-full" />
          <div className="skeleton h-4 w-2/3 rounded-full" />
        </div>
      ))}
    </div>
  );
}
