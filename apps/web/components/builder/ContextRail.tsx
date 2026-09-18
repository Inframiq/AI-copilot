"use client";
import { Target } from "@phosphor-icons/react";
import { useTailoringStore } from "@/stores/tailoring-store";
import { ImportanceBadge } from "@/components/resume/ImportanceBadge";

/** Keeps the rail from growing without bound on a keyword-heavy JD. */
const MAX_KEYWORDS = 8;

/**
 * JD context beside the Builder.
 *
 * Renders only on Path A (JD Analyzer → Tailor → Builder, or a JD pasted in
 * the studio). Path B gets a single clean column — the spec asks for the
 * current section to be the focus, so this appears only when there is real
 * JD context to carry.
 */
export function ContextRail() {
  const jdId = useTailoringStore((s) => s.jdId);
  const jdText = useTailoringStore((s) => s.jdText);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const jdImportance = useTailoringStore((s) => s.jdImportance);

  if (!jdId && !jdText.trim()) return null;

  return (
    <aside className="flex w-full flex-col gap-md lg:w-80 lg:shrink-0">
      <section className="flex flex-col gap-sm rounded-2xl border border-outline-variant/30 bg-surface p-md">
        <h2 className="flex items-center gap-xs text-label-md font-semibold text-on-surface">
          <Target size={18} className="text-primary" />
          Target JD match
        </h2>

        {atsScore !== null && (
          <p data-testid="rail-ats" className="text-caption text-on-surface-variant">
            Your résumé currently covers{" "}
            <strong className="text-on-surface">{atsScore}%</strong> of this job description.
          </p>
        )}

        {missingSkills.length > 0 ? (
          <>
            <p className="text-caption text-on-surface-variant">
              Worth working in where they are genuinely true of you:
            </p>
            <ul className="flex flex-wrap gap-xs">
              {missingSkills.slice(0, MAX_KEYWORDS).map((skill) => {
                const level = jdImportance[skill.trim().toLowerCase()];
                return (
                  <li
                    key={skill}
                    className="flex items-center gap-xs rounded-full border border-outline-variant/40 px-sm py-0.5 text-caption text-on-surface-variant"
                  >
                    {skill}
                    {level && <ImportanceBadge level={level} />}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-caption text-on-surface-variant">
            Nothing missing from this job description — every keyword we found is already
            covered.
          </p>
        )}
      </section>
    </aside>
  );
}
