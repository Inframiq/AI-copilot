"use client";
import { ArrowCounterClockwise, Check, ListNumbers } from "@phosphor-icons/react";
import type { AtsFix } from "@/lib/api-client";
import { MAX_MERGED_SKILLS, defaultSkillKeepDecision } from "@/stores/tailoring-store";
import { FOCUS_RING, PRESS } from "@/lib/focus";

type Decision = "accept" | "reject";

const IMPORTANCE_RANK: Record<AtsFix["importance"], number> = { high: 0, medium: 1, low: 2 };

/**
 * The order skills earn their place on the résumé, best first, within the
 * shared budget:
 *
 *   1. skills you already have that the job asks for — dropping one loses
 *      points, so they are never traded away for a guess;
 *   2. skills to add, biggest ATS gain first;
 *   3. your other skills — true, and harmless to keep.
 *
 * A skill to add that gains nothing is never chosen: it would only pad the
 * list with a claim that does not help.
 */
export function rankForAts({
  original,
  matched,
  candidates,
  cap = MAX_MERGED_SKILLS,
}: {
  original: string[];
  matched: string[];
  candidates: { name: string; delta: number }[];
  cap?: number;
}): string[] {
  const isMatched = new Set(matched.map((m) => m.toLowerCase()));
  const byGain = [...candidates].sort((a, b) => b.delta - a.delta);
  return [
    ...original.filter((s) => isMatched.has(s.toLowerCase())),
    ...byGain.filter((c) => c.delta > 0).map((c) => c.name),
    ...original.filter((s) => !isMatched.has(s.toLowerCase())),
  ].slice(0, cap);
}

/**
 * Skills: what to add, ranked by how much each raises the ATS score, and
 * what you already list. Both draw from one MAX_MERGED_SKILLS budget — the
 * same cap buildMergedContent enforces on the final résumé.
 */
export function SkillsCard({
  originalSkills,
  suggestedSkills,
  skillFixes,
  matchedSkills,
  decisions,
  onDecide,
  onFixDecision,
  onApply,
}: {
  originalSkills: string[];
  /** Plain AI suggestions with no fix behind them (no score estimate). */
  suggestedSkills: string[];
  /** JD-gap skills, each with its own ATS gain (score_delta). */
  skillFixes: AtsFix[];
  /** JD phrases the résumé already covers. */
  matchedSkills: string[];
  decisions: Record<string, string>;
  onDecide: (key: string, d: Decision) => void;
  onFixDecision: (id: string, d: Decision) => void;
  /** Many decisions at once — re-scores once. */
  onApply: (decisions: Record<string, Decision>) => void;
}) {
  if (originalSkills.length === 0 && suggestedSkills.length === 0 && skillFixes.length === 0) {
    return null;
  }

  // Every candidate to add, best ATS gain first. A fix carries its own
  // estimate; a plain suggestion has none and goes last.
  const toAdd = [
    ...[...skillFixes]
      .sort(
        (a, b) =>
          b.score_delta - a.score_delta ||
          IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
          Number(b.default_accept) - Number(a.default_accept) ||
          a.text.localeCompare(b.text),
      )
      .map((f) => ({ name: f.text, key: `fix:${f.id}`, fix: f as AtsFix | null, delta: f.score_delta })),
    ...suggestedSkills.map((s) => ({ name: s, key: `skill_add:${s}`, fix: null as AtsFix | null, delta: 0 })),
  ];
  const maxDelta = Math.max(1, ...toAdd.map((c) => c.delta));

  const isMatched = new Set(matchedSkills.map((m) => m.toLowerCase()));
  const current = [
    ...originalSkills.filter((s) => isMatched.has(s.toLowerCase())),
    ...originalSkills.filter((s) => !isMatched.has(s.toLowerCase())),
  ];

  const keepDefault = defaultSkillKeepDecision(originalSkills.length);
  const isKept = (s: string) => (decisions[`skill_keep:${s}`] ?? keepDefault) === "accept";
  const isAdded = (key: string) => decisions[key] === "accept";
  const totalSelected =
    originalSkills.filter(isKept).length + toAdd.filter((c) => isAdded(c.key)).length;
  const atCap = totalSelected >= MAX_MERGED_SKILLS;

  function toggleAdd(c: (typeof toAdd)[number]) {
    const next: Decision = isAdded(c.key) ? "reject" : "accept";
    if (c.fix) onFixDecision(c.fix.id, next);
    else onDecide(c.key, next);
  }

  function addInAtsOrder() {
    const chosen = new Set(
      rankForAts({
        original: originalSkills,
        matched: matchedSkills,
        candidates: toAdd.map((c) => ({ name: c.name, delta: c.delta })),
      }),
    );
    const next: Record<string, Decision> = {};
    for (const s of originalSkills) next[`skill_keep:${s}`] = chosen.has(s) ? "accept" : "reject";
    for (const c of toAdd) next[c.key] = chosen.has(c.name) ? "accept" : "reject";
    onApply(next);
  }

  return (
    <article aria-label="Skills" className="flex flex-col gap-lg rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm">
      <header className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-start justify-between gap-sm">
          <div>
            <h3 className="text-body-lg font-semibold text-on-surface">Skills</h3>
            <p className="text-caption text-on-surface-variant">
              Ranked by how much each raises your ATS score. Tap to add or remove.
            </p>
          </div>
          {toAdd.length > 0 && (
            <button
              type="button"
              onClick={addInAtsOrder}
              title={`Keeps the skills you have that the job asks for, then adds the biggest gains first, up to ${MAX_MERGED_SKILLS}`}
              className={`flex shrink-0 items-center gap-xs rounded-xl bg-primary px-md py-xs text-label-sm font-semibold text-on-primary active:brightness-90 ${PRESS} ${FOCUS_RING}`}
            >
              <ListNumbers size={14} weight="bold" /> Add in ATS order
            </button>
          )}
        </div>
        <div className="flex items-center gap-sm">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-high"
            role="meter"
            aria-label="Skills on your résumé"
            aria-valuemin={0}
            aria-valuemax={MAX_MERGED_SKILLS}
            aria-valuenow={totalSelected}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${atCap ? "bg-tertiary" : "bg-primary"}`}
              style={{ width: `${Math.min(100, (totalSelected / MAX_MERGED_SKILLS) * 100)}%` }}
            />
          </div>
          <span className="tabular shrink-0 text-caption text-on-surface-variant">
            {totalSelected} / {MAX_MERGED_SKILLS} on your résumé{atCap && " — full"}
          </span>
        </div>
        {originalSkills.length > MAX_MERGED_SKILLS && (
          <p className="rounded-xl bg-tertiary-container/50 px-sm py-xs text-caption text-on-tertiary-container">
            Your résumé lists {originalSkills.length} skills; only {MAX_MERGED_SKILLS} fit. Use “Add in ATS order”, or
            pick the ones that matter most for this job.
          </p>
        )}
      </header>

      {toAdd.length > 0 && (
        <section className="flex flex-col gap-sm">
          <h4 className="text-label-caps text-on-surface-variant">Skills to add — biggest gain first</h4>
          <ol aria-label="Skills to add" className="flex flex-col gap-xs">
            {toAdd.map((c, i) => {
              const on = isAdded(c.key);
              const blocked = !on && atCap;
              return (
                <li
                  key={c.key}
                  className={`flex items-center gap-sm rounded-2xl border px-sm py-xs transition-colors duration-200 ${
                    on ? "border-primary/30 bg-primary/5" : "border-outline-variant/30 bg-surface"
                  }`}
                >
                  <span className="tabular w-5 shrink-0 text-center text-label-sm text-on-surface-variant">{i + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-x-sm">
                      <span className="text-label-md font-semibold text-on-surface">{c.name}</span>
                      {c.fix ? (
                        c.fix.default_accept ? (
                          <span className="text-caption text-success">in your experience</span>
                        ) : (
                          <span className="text-caption text-on-surface-variant">only if you have it</span>
                        )
                      ) : null}
                    </div>
                    {c.delta > 0 && (
                      <div className="flex items-center gap-sm">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                          <div
                            className={`h-full rounded-full ${on ? "bg-primary" : "bg-outline"}`}
                            style={{ width: `${(c.delta / maxDelta) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <span className={`tabular w-14 shrink-0 text-right text-label-sm font-semibold ${c.delta > 0 ? "text-primary" : "text-on-surface-variant"}`}>
                    {c.delta > 0 ? `+${c.delta} pts` : "±0"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Add ${c.name}${c.delta > 0 ? ` (+${c.delta} pts)` : ""}`}
                    disabled={blocked}
                    title={blocked ? `All ${MAX_MERGED_SKILLS} skill slots are used — turn one off first` : undefined}
                    onClick={() => toggleAdd(c)}
                    className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${FOCUS_RING} ${
                      on ? "bg-primary hover:bg-primary/90" : "bg-outline-variant hover:bg-outline"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface-container-lowest shadow transition-transform duration-200 motion-reduce:transition-none ${
                        on ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {current.length > 0 && (
        <section className="flex flex-col gap-sm">
          <h4 className="text-label-caps text-on-surface-variant">Already on your résumé</h4>
          <ul aria-label="Already on your résumé" className="flex flex-wrap gap-xs">
            {current.map((skill) => {
              const kept = isKept(skill);
              const matches = isMatched.has(skill.toLowerCase());
              // Removing always frees a slot; only bringing one back can be
              // blocked once the budget is spent.
              const blocked = !kept && atCap;
              return (
                <li key={skill}>
                  <button
                    type="button"
                    aria-pressed={kept}
                    disabled={blocked}
                    title={
                      blocked
                        ? `All ${MAX_MERGED_SKILLS} skill slots are used — turn one off first`
                        : kept
                          ? `${matches ? "Matches the job. " : ""}Tap to leave it off`
                          : "Left off — tap to keep it"
                    }
                    onClick={() => onDecide(`skill_keep:${skill}`, kept ? "reject" : "accept")}
                    className={`flex items-center gap-xs rounded-full border px-sm py-xs text-label-sm ${PRESS} ${FOCUS_RING} ${
                      kept
                        ? matches
                          ? "border-success/40 bg-success-container/40 text-on-surface hover:border-error/50"
                          : "border-outline-variant/60 bg-surface-container-lowest text-on-surface hover:border-error/50"
                        : blocked
                          ? "cursor-not-allowed border-dashed border-outline-variant/40 text-on-surface-variant/50"
                          : "border-dashed border-outline-variant text-on-surface-variant line-through hover:border-primary/50 hover:text-primary"
                    }`}
                  >
                    {kept ? (
                      <Check size={11} weight="bold" className={matches ? "text-success" : "text-on-surface-variant"} />
                    ) : (
                      <ArrowCounterClockwise size={11} weight="bold" />
                    )}
                    {skill}
                    {matches && kept && <span className="sr-only"> — matches the job</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
