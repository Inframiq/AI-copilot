"use client";
import { ArrowCounterClockwise, Check, ListNumbers, Plus } from "@phosphor-icons/react";
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
  liveDeltas,
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
  /** What each skill fix is worth GIVEN everything currently selected, by fix
   * id. score_delta is measured once at pipeline time against one fixed
   * hypothetical, so a skill whose gap another selection already closed still
   * advertised its full value. Absent until the first live score lands. */
  liveDeltas?: Record<string, number>;
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
  const liveDelta = (f: AtsFix) => liveDeltas?.[f.id] ?? f.score_delta;
  // Nothing already on the résumé is an "addition", and a name arriving from
  // both a fix and a plain suggestion is still one skill. The server filters
  // the same way; this is the belt to its braces, and it also covers sessions
  // whose fixes were built before that filter existed.
  const onResume = new Set(originalSkills.map((k) => k.trim().toLowerCase()));
  const offered = new Set<string>();
  const unseen = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!key || onResume.has(key) || offered.has(key)) return false;
    offered.add(key);
    return true;
  };
  const toAdd = [
    ...[...skillFixes]
      .sort(
        (a, b) =>
          liveDelta(b) - liveDelta(a) ||
          IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
          Number(b.default_accept) - Number(a.default_accept) ||
          a.text.localeCompare(b.text),
      )
      .filter((f) => unseen(f.text))
      .map((f) => ({ name: f.text, key: `fix:${f.id}`, fix: f as AtsFix | null, delta: liveDelta(f) })),
    ...suggestedSkills
      .filter(unseen)
      .map((k) => ({ name: k, key: `skill_add:${k}`, fix: null as AtsFix | null, delta: 0 })),
  ];

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
      {current.length > 0 && (
        <section className="flex flex-col gap-sm">
          <h4 className="text-label-caps text-on-surface-variant">On your résumé now ({current.length})</h4>
          <ul aria-label="On your résumé now" className="flex flex-wrap gap-xs">
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
                    role="switch"
                    aria-checked={kept}
                    aria-label={`Keep ${skill}${matches ? " — matches the job" : ""}`}
                    data-origin="yours"
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
                          ? "border-success/40 bg-success-container/40 text-on-surface"
                          : "border-outline-variant/60 bg-surface-container-lowest text-on-surface"
                        : blocked
                          ? "cursor-not-allowed border-dashed border-outline-variant/40 text-on-surface-variant/50"
                          : "border-dashed border-outline-variant text-on-surface-variant line-through"
                    }`}
                  >
                    {kept ? (
                      <Check size={11} weight="bold" className={matches ? "text-success" : "text-on-surface-variant"} />
                    ) : (
                      <ArrowCounterClockwise size={11} weight="bold" />
                    )}
                    {skill}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {toAdd.length > 0 && (
        <section className="flex flex-col gap-sm">
          <h4 className="text-label-caps text-on-surface-variant">
            Suggested additions ({toAdd.length}) — biggest gain first
          </h4>
          <p className="text-caption text-on-surface-variant">
            Add only what is genuinely true of you. Ones your bullets already evidence are marked.
          </p>
          {/* The same chip as above, differing only in what tells them apart:
              a dotted edge and a + for something not yours yet, against a
              solid edge and a tick for something that already is. One budget,
              one control, two states. */}
          <ul aria-label="Suggested additions" className="flex flex-wrap gap-xs">
            {toAdd.map((c) => {
              const on = isAdded(c.key);
              const blocked = !on && atCap;
              const evidenced = c.fix?.default_accept;
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Add ${c.name}${c.delta > 0 ? ` (+${c.delta} pts)` : ""}`}
                    data-origin="suggested"
                    disabled={blocked}
                    title={
                      blocked
                        ? `All ${MAX_MERGED_SKILLS} skill slots are used — turn one off first`
                        : !evidenced
                          ? `Only if you have it. ${c.delta > 0 ? `Adds ${c.delta} points.` : "Already covered."}`
                          : c.delta > 0
                            ? `Adds ${c.delta} points to your match for this job`
                            : "Already covered — adding it changes nothing"
                    }
                    onClick={() => toggleAdd(c)}
                    className={`flex items-center gap-xs rounded-full border px-sm py-xs text-label-sm ${PRESS} ${FOCUS_RING} ${
                      on
                        ? "border-primary/50 bg-primary/10 text-on-surface"
                        : blocked
                          ? "cursor-not-allowed border-dashed border-outline-variant/40 text-on-surface-variant/50"
                          : "border-dashed border-outline-variant text-on-surface-variant"
                    }`}
                  >
                    {on ? <Check size={11} weight="bold" className="text-primary" /> : <Plus size={11} weight="bold" />}
                    {c.name}
                    {/* "in your experience" earns its space — it says the
                        résumé already evidences this one. The converse
                        applies to every other chip in this group, so it is
                        said once in the caption and kept here for the tooltip
                        and for screen readers rather than repeated in ink. */}
                    {c.fix &&
                      (evidenced ? (
                        <span className="text-caption text-success">in your experience</span>
                      ) : (
                        <span className="sr-only">only if you have it</span>
                      ))}
                    {c.delta > 0 && (
                      <span className={`tabular text-caption font-semibold ${on ? "text-primary" : "text-on-surface-variant"}`}>
                        +{c.delta} pts
                      </span>
                    )}
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
