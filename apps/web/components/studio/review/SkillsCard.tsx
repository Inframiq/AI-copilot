"use client";
import { Check, X, Target } from "@phosphor-icons/react";
import type { AtsFix } from "@/lib/api-client";
import { MAX_MERGED_SKILLS, defaultSkillKeepDecision } from "@/stores/tailoring-store";
import type { ImportanceLevel } from "@/components/resume/ImportanceBadge";

// Ported from SkillsBlock in components/resume/BulletReviewPanel.tsx — same
// store calls, same props (renamed only where the old names were store
// action names), restyled to match SummaryCard's deck-card presentation.

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

export function SkillsCard({
  originalSkills,
  suggestedSkills,
  skillFixes,
  prioritySkills,
  missingSkills,
  companyKeywords,
  decisions,
  onDecide,
  onFixDecision,
  onRefreshProjected,
  onApply,
}: {
  originalSkills: string[];
  suggestedSkills: string[];
  skillFixes: AtsFix[];
  prioritySkills: string[];
  missingSkills: string[];
  companyKeywords: string[];
  decisions: Record<string, string>;
  onDecide: (key: string, d: "accept" | "reject") => void;
  onFixDecision: (id: string, d: "accept" | "reject") => void;
  onRefreshProjected: () => void;
  onApply: (decisions: Record<string, "accept" | "reject">) => void;
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
  const isAddSelected = (skill: string) => decisions[addKey(skill)] === "accept";

  // Both "which existing skills to keep" and "which suggested skills to
  // add" draw from the same MAX_MERGED_SKILLS budget — matches
  // buildMergedContent, so hitting the limit here reads as the same
  // guardrail the final resume will actually enforce, not a separate rule.
  const keepDefault = defaultSkillKeepDecision(originalSkills.length);
  const keptCount = originalSkills.filter(
    (s) => (decisions[`skill_keep:${s}`] ?? keepDefault) === "accept",
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

    const nextDecisions: Record<string, "accept" | "reject"> = {};
    for (const skill of originalSkills) nextDecisions[`skill_keep:${skill}`] = top.has(skill) ? "accept" : "reject";
    for (const skill of addCandidates) nextDecisions[addKey(skill)] = top.has(skill) ? "accept" : "reject";
    onApply(nextDecisions);
    // onApply doesn't re-score on its own — kick the projected total.
    onRefreshProjected();
  }

  function renderKeepChip(skill: string) {
    const key = `skill_keep:${skill}`;
    const kept = (decisions[key] ?? keepDefault) === "accept";
    // Removing always frees a slot, so it's never blocked; only re-adding
    // (undoing a removal) can be blocked once the shared budget is spent.
    const disabled = !kept && atCap;
    return (
      <button
        key={skill}
        disabled={disabled}
        title={disabled ? `Skills limit reached (${MAX_MERGED_SKILLS}) — remove another to bring this back` : undefined}
        onClick={() => onDecide(key, kept ? "reject" : "accept")}
        className={`flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
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
    const selected = decisions[key] === "accept";
    const isPriority = prioritySet.has(skill.toLowerCase());
    const disabled = !selected && atCap;
    const tier = tierOf(skill);
    const toggle = () =>
      fix
        ? onFixDecision(fix.id, selected ? "reject" : "accept")
        : onDecide(key, selected ? "reject" : "accept");
    return (
      <button
        key={skill}
        disabled={disabled}
        title={disabled ? `Skills limit reached (${MAX_MERGED_SKILLS}) — deselect another to add this one` : `${tier} priority`}
        onClick={toggle}
        className={`flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
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
    <article className="flex flex-col gap-md rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm">
      <div>
        <div className="flex items-start justify-between gap-sm">
          <h3 className="text-label-caps text-on-surface-variant">Skills</h3>
          <button
            type="button"
            onClick={handleAutoSelectTop}
            title="Ranks every current + suggested skill by fit for this JD and selects the top ones — you can still adjust any pick afterward"
            className="shrink-0 flex items-center gap-xs px-sm py-xs rounded-full text-caption text-primary border border-primary/30 hover:bg-primary/5 transition-colors"
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
          <span className="text-label-caps text-on-surface-variant">Your Current Skills</span>
          {originalTechnical.length > 0 && (
            <div className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Technical</span>
              <div className="flex flex-wrap gap-xs">{originalTechnical.map(renderKeepChip)}</div>
            </div>
          )}
          {originalSoft.length > 0 && (
            <div className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Soft Skills</span>
              <div className="flex flex-wrap gap-xs">{originalSoft.map(renderKeepChip)}</div>
            </div>
          )}
        </div>
      )}

      {addCandidates.length > 0 && (
        <div className="flex flex-col gap-sm">
          <span className="text-label-caps text-on-surface-variant">
            Skills to Add for this JD
            {prioritySkills.length > 0 && (
              <span className="font-normal text-caption text-on-surface-variant"> — ★ marks the keywords you picked on the JD page</span>
            )}
          </span>
          {suggestedTechnical.length > 0 && (
            <div className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Technical</span>
              <div className="flex flex-wrap gap-xs">{suggestedTechnical.map(renderAddChip)}</div>
            </div>
          )}
          {suggestedSoft.length > 0 && (
            <div className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Soft Skills</span>
              <div className="flex flex-wrap gap-xs">{suggestedSoft.map(renderAddChip)}</div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
