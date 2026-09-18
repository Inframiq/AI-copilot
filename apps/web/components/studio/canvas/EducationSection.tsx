"use client";
import { useEffect, useRef } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { Trash } from "@phosphor-icons/react";

// Ported from EditorPanel's "Education Tab" — same store calls.
export function EducationSection({ focusIndex }: { focusIndex?: number }) {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const entryRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (focusIndex === undefined) return;
    const el = entryRefs.current[focusIndex];
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusIndex]);

  if (!content) return null;

  return (
    <section className="flex flex-col gap-lg">
      <h2 className="text-label-caps text-on-surface-variant">Education</h2>

      {content.education.map((edu, i) => (
        <div
          key={i}
          ref={(el) => { entryRefs.current[i] = el; }}
          className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-lg flex flex-col gap-md hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-xs">
            <span className="text-label-sm text-on-surface-variant font-bold uppercase tracking-wider">
              Education {i + 1}
            </span>
            <button
              onClick={() => {
                const updated = content.education.filter((_, idx) => idx !== i);
                updateContent({ education: updated });
              }}
              className="flex items-center gap-xs text-label-sm text-error px-sm py-xs rounded-lg hover:bg-error-container/30 transition-colors"
            >
              <Trash size={14} />
              Remove
            </button>
          </div>

          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant">Institution</label>
            <input
              type="text"
              value={edu.institution}
              onChange={(e) => {
                const updated = [...content.education];
                updated[i] = { ...updated[i], institution: e.target.value };
                updateContent({ education: updated });
              }}
              placeholder="University name"
              className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">Degree</label>
              <input
                type="text"
                value={edu.degree}
                onChange={(e) => {
                  const updated = [...content.education];
                  updated[i] = { ...updated[i], degree: e.target.value };
                  updateContent({ education: updated });
                }}
                placeholder="e.g. B.S. Computer Science"
                className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">Year</label>
              <input
                type="text"
                value={edu.year}
                onChange={(e) => {
                  const updated = [...content.education];
                  updated[i] = { ...updated[i], year: e.target.value };
                  updateContent({ education: updated });
                }}
                placeholder="e.g. 2020"
                className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={() =>
          updateContent({
            education: [
              ...content.education,
              { institution: "", degree: "", year: "" },
            ],
          })
        }
        className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-dashed border-outline-variant text-primary text-label-md hover:bg-surface-container-low transition-colors"
      >
        + Add Education
      </button>
    </section>
  );
}
