"use client";
import { useMemo, useState } from "react";
import { Check, X, ArrowCounterClockwise, Plus, FilePdf } from "@phosphor-icons/react";
import { useTailoringStore, type BulletChange } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient } from "@/lib/api-client";

export function BulletReviewPanel() {
  const pendingContent = useTailoringStore((s) => s.pendingContent);
  const bulletDecisions = useTailoringStore((s) => s.bulletDecisions);
  const setBulletDecision = useTailoringStore((s) => s.setBulletDecision);
  const setAllBulletDecisions = useTailoringStore((s) => s.setAllBulletDecisions);
  const applyDecisions = useTailoringStore((s) => s.applyDecisions);
  const discardPending = useTailoringStore((s) => s.discardPending);
  const isApplying = useTailoringStore((s) => s.isApplying);
  const companyKeywords = useTailoringStore((s) => s.companyKeywords);
  const companyName = useTailoringStore((s) => s.companyName);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const suggestedSkills = useTailoringStore((s) => s.suggestedSkills);

  const resumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);
  const originalContent = useResumeStore((s) => s.content);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // ── Bullet changes (experience only) ────────────────────────────────────
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
  const totalChanges = bulletChanges.length;

  // All bullets have been explicitly decided (Accept or Keep original clicked)
  const allDecided = bulletChanges.length === 0 ||
    bulletChanges.every((c) => c.key in bulletDecisions);

  async function handleAcceptAll() {
    setAllBulletDecisions(bulletChanges, "accept");
  }

  async function handleGeneratePdf() {
    if (!resumeId) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      await applyDecisions(resumeId);
      const { signed_url } = await apiClient.generatePdf(resumeId, templateId);
      setPdfSignedUrl(signed_url);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  if (!pendingContent) return null;

  // ── Group bullets by job ─────────────────────────────────────────────────
  const groups = bulletChanges.reduce<Record<string, { label: string; changes: BulletChange[] }>>(
    (acc, change) => {
      const groupKey = `${change.jobTitle}||${change.company}`;
      if (!acc[groupKey]) {
        acc[groupKey] = {
          label: change.company ? `${change.jobTitle} · ${change.company}` : change.jobTitle,
          changes: [],
        };
      }
      acc[groupKey].changes.push(change);
      return acc;
    },
    {},
  );

  if (totalChanges === 0) {
    return (
      <div className="flex flex-col gap-md">
        <div className="rounded-xl border border-outline-variant/20 p-lg text-center bg-surface">
          <p className="text-body-sm text-on-surface-variant">
            No changes to review — your resume is already well-aligned with this JD.
          </p>
        </div>
        <button
          onClick={discardPending}
          className="w-full py-sm rounded-xl border border-outline-variant text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      {/* Header — no bulk action buttons here */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-label-md font-bold text-on-surface">Review AI Changes</p>
          <p className="text-caption text-on-surface-variant">
            {acceptedBullets} of {bulletChanges.length} bullet{bulletChanges.length !== 1 ? "s" : ""} accepted
            {atsScore !== null && ` · ATS Score: ${atsScore}%`}
          </p>
        </div>
        <button
          onClick={discardPending}
          className="flex items-center gap-xs px-sm py-xs rounded-lg text-caption text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container-low transition-colors"
        >
          <ArrowCounterClockwise size={13} />
          Discard
        </button>
      </div>

      {/* Company keywords */}
      {companyKeywords.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary-container/20 p-md flex flex-col gap-sm">
          <p className="text-label-sm font-bold text-primary">{companyName} ATS Keywords Injected</p>
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

      {/* ── Suggested skills: user opts in per chip ── */}
      {suggestedSkills.length > 0 && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-sm">
          <div>
            <p className="text-label-sm text-on-surface font-bold">Suggested Skills to Add</p>
            <p className="text-caption text-on-surface-variant">Click a skill to add it to your resume</p>
          </div>
          <div className="flex flex-wrap gap-xs">
            {suggestedSkills.map((skill) => {
              const selected = bulletDecisions[`skill_add:${skill}`] === "accept";
              return (
                <button
                  key={skill}
                  onClick={() =>
                    setBulletDecision(`skill_add:${skill}`, selected ? "reject" : "accept")
                  }
                  className={`flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
                    selected
                      ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30 font-medium"
                      : "bg-surface-container text-on-surface-variant border-outline-variant/40 hover:border-primary/40 hover:text-primary"
                  }`}
                >
                  {selected ? (
                    <Check size={11} weight="bold" />
                  ) : (
                    <Plus size={11} weight="bold" />
                  )}
                  {skill}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bullet changes grouped by job ── */}
      {Object.entries(groups).map(([groupKey, group]) => (
        <div key={groupKey} className="flex flex-col gap-sm">
          <p className="text-label-sm text-on-surface-variant font-bold uppercase tracking-wider">
            {group.label}
          </p>
          {group.changes.map((change) => {
            const isAccepted = (bulletDecisions[change.key] ?? "accept") === "accept";
            const isDecided = change.key in bulletDecisions;
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
                <div className="flex flex-col gap-xs">
                  <span className="text-caption text-on-surface-variant uppercase tracking-wider">
                    Original
                  </span>
                  <p className="text-body-sm text-on-surface-variant line-through leading-relaxed">
                    {change.original || <em className="not-italic opacity-50">— empty —</em>}
                  </p>
                </div>
                <div className="flex flex-col gap-xs">
                  <span className="text-caption text-primary uppercase tracking-wider font-bold">
                    AI Tailored
                  </span>
                  <p className="text-body-sm text-on-surface leading-relaxed">{change.tailored}</p>
                </div>
                <div className="flex gap-xs pt-xs">
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
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <SkillsDelta />

      {/* ── Bottom action area ── */}
      <div className="flex flex-col gap-sm pt-xs border-t border-outline-variant/20 mt-xs">
        {/* Accept All — always visible until all decided */}
        {!allDecided && (
          <button
            onClick={handleAcceptAll}
            className="w-full py-sm rounded-xl text-label-md text-primary border border-primary/40 hover:bg-primary/5 transition-all"
          >
            Accept All
          </button>
        )}

        {/* Generate PDF — only after all decisions made */}
        {allDecided && (
          <>
            {generateError && <p className="text-caption text-error">{generateError}</p>}
            <button
              onClick={handleGeneratePdf}
              disabled={isApplying || isGenerating || !resumeId}
              className="w-full flex items-center justify-center gap-sm py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              <FilePdf size={18} />
              {isGenerating ? "Generating PDF…" : isApplying ? "Applying…" : "Generate PDF"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
