"use client";
import { useMemo } from "react";
import { Check, X, ArrowCounterClockwise, Plus } from "@phosphor-icons/react";
import { useTailoringStore, type BulletChange } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { SkillsDelta } from "./SkillsDelta";

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
  const resumeId = useResumeStore((s) => s.resumeId);
  const originalContent = useResumeStore((s) => s.content);

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

  // ── Skill changes ────────────────────────────────────────────────────────
  const { addedSkills, removedSkills } = useMemo(() => {
    if (!pendingContent || !originalContent) return { addedSkills: [], removedSkills: [] };
    const origSet = new Set(originalContent.skills);
    const tailSet = new Set(pendingContent.skills);
    return {
      addedSkills: pendingContent.skills.filter((s) => !origSet.has(s)),
      removedSkills: originalContent.skills.filter((s) => !tailSet.has(s)),
    };
  }, [pendingContent, originalContent]);

  const hasSkillChanges = addedSkills.length > 0 || removedSkills.length > 0;

  // ── Accepted counts ──────────────────────────────────────────────────────
  const acceptedBullets = bulletChanges.filter(
    (c) => (bulletDecisions[c.key] ?? "accept") === "accept",
  ).length;
  const acceptedAdded = addedSkills.filter(
    (s) => (bulletDecisions[`skill_add:${s}`] ?? "accept") === "accept",
  ).length;
  const restoredRemoved = removedSkills.filter(
    (s) => (bulletDecisions[`skill_rm:${s}`] ?? "reject") === "accept",
  ).length;
  const totalAccepted = acceptedBullets + acceptedAdded + restoredRemoved;
  const totalChanges = bulletChanges.length + addedSkills.length + removedSkills.length;

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
        <SkillsDelta />
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-label-md font-bold text-on-surface">Review AI Changes</p>
          <p className="text-caption text-on-surface-variant">
            {totalAccepted} of {totalChanges} change{totalChanges !== 1 ? "s" : ""} accepted
            {atsScore !== null && ` · ATS Score: ${atsScore}%`}
          </p>
        </div>
        <div className="flex gap-xs">
          <button
            onClick={() => setAllBulletDecisions(bulletChanges, "accept")}
            className="px-sm py-xs rounded-lg text-caption text-primary border border-primary/30 hover:bg-primary/5 transition-colors"
          >
            Accept all
          </button>
          <button
            onClick={() => setAllBulletDecisions(bulletChanges, "reject")}
            className="px-sm py-xs rounded-lg text-caption text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container-low transition-colors"
          >
            Reject all
          </button>
        </div>
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

      {/* ── Skills section: per-chip toggles ── */}
      {hasSkillChanges && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-sm">
          <p className="text-label-sm text-on-surface-variant font-bold uppercase tracking-wider">
            AI Tailored · Skills
          </p>

          {/* Added skills — default accepted, click to reject */}
          {addedSkills.length > 0 && (
            <div className="flex flex-col gap-xs">
              <span className="text-caption text-primary font-bold uppercase tracking-wider">
                Added by AI — click to remove
              </span>
              <div className="flex flex-wrap gap-xs">
                {addedSkills.map((skill) => {
                  const accepted = (bulletDecisions[`skill_add:${skill}`] ?? "accept") === "accept";
                  return (
                    <button
                      key={skill}
                      onClick={() =>
                        setBulletDecision(`skill_add:${skill}`, accepted ? "reject" : "accept")
                      }
                      title={accepted ? "Click to remove this skill" : "Click to add back"}
                      className={`group flex items-center gap-xs px-sm py-xs rounded-full text-label-sm transition-all ${
                        accepted
                          ? "bg-[#e6f4ea] text-[#1e7e34] hover:bg-[#c8e6c9]"
                          : "bg-surface-container text-on-surface-variant line-through opacity-50 hover:opacity-80"
                      }`}
                    >
                      {accepted ? (
                        <>
                          <Check size={11} weight="bold" className="group-hover:hidden" />
                          <X size={11} weight="bold" className="hidden group-hover:block text-error" />
                        </>
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

          {/* Removed skills — default rejected (AI removed them), click to restore */}
          {removedSkills.length > 0 && (
            <div className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant font-bold uppercase tracking-wider">
                Removed by AI — click to keep
              </span>
              <div className="flex flex-wrap gap-xs">
                {removedSkills.map((skill) => {
                  const restored = (bulletDecisions[`skill_rm:${skill}`] ?? "reject") === "accept";
                  return (
                    <button
                      key={skill}
                      onClick={() =>
                        setBulletDecision(`skill_rm:${skill}`, restored ? "reject" : "accept")
                      }
                      title={restored ? "Click to remove again" : "Click to keep this skill"}
                      className={`group flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
                        restored
                          ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30"
                          : "bg-error-container/30 text-on-error-container border-error/20 line-through opacity-60 hover:opacity-90"
                      }`}
                    >
                      {restored ? (
                        <>
                          <Check size={11} weight="bold" className="group-hover:hidden" />
                          <X size={11} weight="bold" className="hidden group-hover:block" />
                        </>
                      ) : (
                        <>
                          <X size={11} weight="bold" className="group-hover:hidden" />
                          <Plus size={11} weight="bold" className="hidden group-hover:block" />
                        </>
                      )}
                      {skill}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
            return (
              <div
                key={change.key}
                className={`rounded-xl border p-md flex flex-col gap-sm transition-all ${
                  isAccepted
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
                      isAccepted
                        ? "bg-primary text-on-primary shadow-sm"
                        : "border border-outline-variant/40 text-on-surface-variant hover:border-primary hover:text-primary"
                    }`}
                  >
                    <Check size={14} weight={isAccepted ? "bold" : "regular"} />
                    Accept
                  </button>
                  <button
                    onClick={() => setBulletDecision(change.key, "reject")}
                    className={`flex items-center gap-xs px-md py-xs rounded-lg text-label-sm transition-all ${
                      !isAccepted
                        ? "bg-error text-on-error shadow-sm"
                        : "border border-outline-variant/40 text-on-surface-variant hover:border-error hover:text-error"
                    }`}
                  >
                    <X size={14} weight={!isAccepted ? "bold" : "regular"} />
                    Keep original
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <SkillsDelta />

      {/* Action buttons */}
      <div className="flex gap-sm pt-xs">
        <button
          onClick={discardPending}
          className="flex items-center justify-center gap-xs px-md py-sm rounded-xl border border-outline-variant text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors"
        >
          <ArrowCounterClockwise size={16} />
          Discard
        </button>
        <button
          onClick={() => resumeId && applyDecisions(resumeId)}
          disabled={isApplying || !resumeId || totalAccepted === 0}
          className="flex-1 py-sm rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isApplying
            ? "Applying…"
            : totalAccepted === 0
            ? "Nothing to apply"
            : `Apply ${totalAccepted} Change${totalAccepted !== 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}
