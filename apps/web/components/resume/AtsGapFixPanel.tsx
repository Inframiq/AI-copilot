"use client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { ImportanceBadge } from "./ImportanceBadge";

// The post-tailor "gap → fix" list: an accept/reject row per proposed skill,
// bullet, or headline, each carrying a High/Medium/Low importance mark and its
// indicative "+X%" ATS impact, under a running "current → projected" header.
export function AtsGapFixPanel() {
  const atsScore = useTailoringStore((s) => s.atsScore);
  const projected = useTailoringStore((s) => s.projectedAtsScore);
  const fixes = useTailoringStore((s) => s.atsFixes);
  const decisions = useTailoringStore((s) => s.bulletDecisions);
  const setFixDecision = useTailoringStore((s) => s.setFixDecision);

  if (atsScore === null) return null;

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <span className="text-label-md text-on-surface-variant">ATS Score</span>
        <span className="text-headline-md font-bold">
          <span className="text-on-surface-variant">{atsScore}%</span>
          {projected !== null && projected !== atsScore && (
            <span className="text-primary"> → {projected}%</span>
          )}
        </span>
      </div>

      {fixes.length === 0 ? (
        <p className="text-caption text-on-surface-variant">No suggested additions for this JD.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {fixes.map((f) => {
            const decision = decisions[`fix:${f.id}`] ?? (f.default_accept ? "accept" : "reject");
            const accepted = decision === "accept";
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
                    {f.type === "skill" ? "Add skill" : f.type === "headline" ? "Headline" : "New bullet"} · {f.gap}
                  </span>
                </div>
                <p className="text-body-sm text-on-surface">{f.text}</p>
                {!f.grounded && (
                  <p className="text-caption text-tertiary">
                    Speculative — only add if you&rsquo;ve actually done this.
                  </p>
                )}
                <div className="flex gap-xs">
                  <button
                    type="button"
                    aria-label={`Accept ${f.gap}`}
                    onClick={() => setFixDecision(f.id, "accept")}
                    className={`px-sm py-xs rounded-full text-label-sm border ${
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
                    className={`px-sm py-xs rounded-full text-label-sm border ${
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
      )}
    </div>
  );
}
