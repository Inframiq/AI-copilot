"use client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { ImportanceBadge } from "@/components/resume/ImportanceBadge";

// Ported from components/resume/AtsGapFixPanel.tsx — same store reads and
// the same setFixDecision / refreshProjectedScore / setFixExperienceIndex
// calls, restyled for the rail's narrow 260px column: fixes stack one row
// each rather than side by side, and the panel sits ambient in the rail
// footer instead of another block in a long scroll.
export function BoostPanel() {
  const atsScore = useTailoringStore((s) => s.atsScore);
  const fixes = useTailoringStore((s) => s.atsFixes);
  const decisions = useTailoringStore((s) => s.bulletDecisions);
  const fixExperienceIndex = useTailoringStore((s) => s.fixExperienceIndex);
  const setFixDecision = useTailoringStore((s) => s.setFixDecision);
  const setFixExperienceIndex = useTailoringStore((s) => s.setFixExperienceIndex);
  const pendingContent = useTailoringStore((s) => s.pendingContent);

  const contentFixes = fixes.filter((f) => f.type === "bullet" || f.type === "headline");
  if (atsScore === null || contentFixes.length === 0) return null;

  const roles = (pendingContent?.experience ?? []).map((e, i) => ({
    index: i,
    label: [e.title, e.company].filter(Boolean).join(" · ") || `Role ${i + 1}`,
  }));

  // Points still on the table — the sum of every not-yet-accepted fix's
  // score delta, shown beside the heading so the rail hints at how much
  // upside is left without the user opening the list.
  const remainingPoints = contentFixes.reduce((sum, f) => {
    const decision = decisions[`fix:${f.id}`] ?? (f.default_accept ? "accept" : "reject");
    return decision === "accept" ? sum : sum + f.score_delta;
  }, 0);

  return (
    <div className="flex flex-col gap-sm border-t border-outline-variant/20 p-sm">
      <div className="flex items-center justify-between gap-xs">
        <h3 className="text-label-caps text-on-surface-variant">Boost</h3>
        {remainingPoints > 0 && (
          <span className="tabular text-caption text-primary font-semibold">
            +{remainingPoints}% left
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-sm">
        {contentFixes.map((f) => {
          const decision = decisions[`fix:${f.id}`] ?? (f.default_accept ? "accept" : "reject");
          const accepted = decision === "accept";
          const roleValue = fixExperienceIndex[f.id] ?? f.experience_index ?? 0;
          return (
            <li
              key={f.id}
              className={`flex flex-col gap-xs rounded-xl border p-sm ${
                !f.grounded ? "border-tertiary/40 bg-tertiary/5" : "border-outline-variant/30"
              }`}
            >
              <div className="flex flex-col gap-xs">
                <ImportanceBadge level={f.importance} />
                <span className="text-caption text-on-surface-variant">
                  {f.type === "headline" ? "Headline" : "New bullet"} · {f.gap}
                </span>
                {f.score_delta > 0 && (
                  <span className="tabular text-caption text-primary font-semibold">
                    +{f.score_delta}%
                  </span>
                )}
              </div>
              <p className="text-body-sm text-on-surface">{f.text}</p>
              {!f.grounded && (
                <p className="text-caption text-tertiary">
                  Speculative — only add if you&rsquo;ve actually done this.
                </p>
              )}
              {f.type === "bullet" && roles.length > 0 && (
                <label className="flex flex-col gap-xs text-caption text-on-surface-variant">
                  Add under
                  <select
                    aria-label={`Role for ${f.gap}`}
                    value={roleValue}
                    onChange={(e) => setFixExperienceIndex(f.id, Number(e.target.value))}
                    className="w-full px-xs py-0.5 rounded-md border border-outline-variant/40 bg-surface text-caption"
                  >
                    {roles.map((r) => (
                      <option key={r.index} value={r.index}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex flex-col gap-xs">
                <button
                  type="button"
                  aria-label={`Accept ${f.gap}`}
                  onClick={() => setFixDecision(f.id, "accept")}
                  className={`w-full px-sm py-xs rounded-full text-label-sm border ${
                    accepted
                      ? "bg-primary text-on-primary border-primary"
                      : "border-outline-variant/40 text-on-surface-variant"
                  }`}
                >
                  Accept
                </button>
                <button
                  type="button"
                  aria-label={`Reject ${f.gap}`}
                  onClick={() => setFixDecision(f.id, "reject")}
                  className={`w-full px-sm py-xs rounded-full text-label-sm border ${
                    !accepted
                      ? "bg-surface-container text-on-surface border-outline-variant/40"
                      : "border-outline-variant/40 text-on-surface-variant"
                  }`}
                >
                  Skip
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
