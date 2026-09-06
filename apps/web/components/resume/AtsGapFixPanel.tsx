"use client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { ImportanceBadge } from "./ImportanceBadge";

// New content the tailoring pass proposes ADDING to the résumé — extra bullet
// points and (optionally) a headline — as an accept/reject list, each with a
// High/Med/Low importance mark and its indicative "+X%" ATS impact. JD-gap
// SKILLS are handled in the Skills section, not here.
export function AtsGapFixPanel() {
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

  return (
    <div className="flex flex-col gap-sm">
      <p className="text-label-sm text-on-surface font-bold">Extra points to add</p>
      <ul className="flex flex-col gap-sm">
        {contentFixes.map((f) => {
          const decision = decisions[`fix:${f.id}`] ?? (f.default_accept ? "accept" : "reject");
          const accepted = decision === "accept";
          const roleValue = fixExperienceIndex[f.id] ?? f.experience_index ?? 0;
          return (
            <li
              key={f.id}
              className={`rounded-xl border p-sm flex flex-col gap-xs ${
                !f.grounded ? "border-tertiary/40 bg-tertiary/5" : "border-outline-variant/30"
              }`}
            >
              <div className="flex items-center gap-sm flex-wrap">
                <ImportanceBadge level={f.importance} />
                {f.score_delta > 0 && (
                  <span className="text-caption text-primary font-semibold">+{f.score_delta}%</span>
                )}
                <span className="text-caption text-on-surface-variant">
                  {f.type === "headline" ? "Headline" : "New bullet"} · {f.gap}
                </span>
              </div>
              <p className="text-body-sm text-on-surface">{f.text}</p>
              {!f.grounded && (
                <p className="text-caption text-tertiary">
                  Speculative — only add if you&rsquo;ve actually done this.
                </p>
              )}
              {f.type === "bullet" && roles.length > 0 && (
                <label className="text-caption text-on-surface-variant flex items-center gap-xs">
                  Add under
                  <select
                    aria-label={`Role for ${f.gap}`}
                    value={roleValue}
                    onChange={(e) => setFixExperienceIndex(f.id, Number(e.target.value))}
                    className="px-xs py-0.5 rounded-md border border-outline-variant/40 bg-surface text-caption"
                  >
                    {roles.map((r) => (
                      <option key={r.index} value={r.index}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex gap-xs">
                <button
                  type="button"
                  aria-label={`Accept ${f.gap}`}
                  onClick={() => setFixDecision(f.id, "accept")}
                  className={`px-sm py-xs pill rounded-full text-label-sm border ${
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
                  className={`px-sm py-xs pill rounded-full text-label-sm border ${
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
