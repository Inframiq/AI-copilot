"use client";
import { useEffect, useRef } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { sameCompany } from "@/lib/career-profile-client";
import { Trash } from "@phosphor-icons/react";

// Ported from EditorPanel's "Experience Tab" — same store calls, same
// merge affordance and helper.
export function ExperienceSection({ focusIndex }: { focusIndex?: number }) {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const entryRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (focusIndex === undefined) return;
    const el = entryRefs.current[focusIndex];
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusIndex]);

  if (!content) return null;

  // Merges Position i into the immediately preceding Position — offered
  // only when the two share a company (see sameCompany), which is exactly
  // when the PDF templates already render them grouped under one company
  // header. Resume entries are conventionally most-recent-first, so the
  // preceding entry (i - 1) is treated as the more recent role: its title
  // and end date (e.g. "Present") survive, the older role's start date
  // becomes the merged entry's start, and both roles' bullets are kept —
  // recent role's first, since that's the more relevant position — rather
  // than silently dropping either one's content.
  const mergeExperienceIntoPreviousRole = (i: number) => {
    const recent = content.experience[i - 1];
    const older = content.experience[i];
    const merged = {
      ...recent,
      start: older.start,
      bullets: [...recent.bullets, ...older.bullets],
    };
    const updated = content.experience.filter((_, idx) => idx !== i && idx !== i - 1);
    updated.splice(i - 1, 0, merged);
    updateContent({ experience: updated });
  };

  return (
    <section className="flex flex-col gap-lg">
      <h2 className="text-label-caps text-on-surface-variant">Experience</h2>

      {content.experience.map((job, i) => (
        <div key={i} ref={(el) => { entryRefs.current[i] = el; }}>
          {sameCompany(job.company, content.experience[i - 1]?.company) && (
            <div className="flex items-center justify-between gap-md mb-md px-md py-sm rounded-xl bg-primary/5 border border-primary/20">
              <p className="text-caption text-on-surface-variant">
                Same company as the role above — your resume will already show these grouped
                under one company header. Prefer a single combined entry instead?
              </p>
              <button
                onClick={() => mergeExperienceIntoPreviousRole(i)}
                className="shrink-0 text-label-sm text-primary font-semibold px-sm py-xs rounded-lg hover:bg-primary/10 transition-colors whitespace-nowrap"
              >
                Merge into one entry
              </button>
            </div>
          )}
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-lg flex flex-col gap-md hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-xs">
              <span className="text-label-sm text-on-surface-variant font-bold uppercase tracking-wider">
                Position {i + 1}
              </span>
              <button
                onClick={() => {
                  const updated = content.experience.filter((_, idx) => idx !== i);
                  updateContent({ experience: updated });
                }}
                className="flex items-center gap-xs text-label-sm text-error px-sm py-xs rounded-lg hover:bg-error-container/30 transition-colors"
              >
                <Trash size={14} />
                Remove
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Company</label>
                <input
                  type="text"
                  value={job.company}
                  onChange={(e) => {
                    const updated = [...content.experience];
                    updated[i] = { ...updated[i], company: e.target.value };
                    updateContent({ experience: updated });
                  }}
                  placeholder="Company name"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Role</label>
                <input
                  type="text"
                  value={job.title}
                  onChange={(e) => {
                    const updated = [...content.experience];
                    updated[i] = { ...updated[i], title: e.target.value };
                    updateContent({ experience: updated });
                  }}
                  placeholder="Job title"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Start</label>
                <input
                  type="text"
                  value={job.start}
                  onChange={(e) => {
                    const updated = [...content.experience];
                    updated[i] = { ...updated[i], start: e.target.value };
                    updateContent({ experience: updated });
                  }}
                  placeholder="e.g. Jan 2021"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">End</label>
                <input
                  type="text"
                  value={job.end ?? ""}
                  onChange={(e) => {
                    const updated = [...content.experience];
                    updated[i] = { ...updated[i], end: e.target.value };
                    updateContent({ experience: updated });
                  }}
                  placeholder="e.g. Present"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
            </div>

            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">
                Bullet Points <span className="font-normal">(one per line)</span>
              </label>
              <textarea
                value={job.bullets.join("\n")}
                onChange={(e) => {
                  const updated = [...content.experience];
                  updated[i] = {
                    ...updated[i],
                    bullets: e.target.value.split("\n"),
                  };
                  updateContent({ experience: updated });
                }}
                rows={4}
                placeholder="• Led team of 5 engineers…&#10;• Improved performance by 40%…"
                className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={() =>
          updateContent({
            experience: [
              ...content.experience,
              { company: "", title: "", start: "", end: "", bullets: [] },
            ],
          })
        }
        className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-dashed border-outline-variant text-primary text-label-md hover:bg-surface-container-low transition-colors"
      >
        + Add Experience
      </button>
    </section>
  );
}
