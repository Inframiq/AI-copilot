"use client";
import { useResumeStore } from "@/stores/resume-store";
import { Trash } from "@phosphor-icons/react";

// Ported from EditorPanel's "Languages Tab" and "Certifications Tab" —
// combined into one section with three sub-headings, same store calls.
export function ExtrasSection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  if (!content) return null;

  return (
    <section className="flex flex-col gap-lg">
      <h2 className="text-label-caps text-on-surface-variant">Extras</h2>

      <div className="flex flex-col gap-md">
        <h3 className="text-label-caps text-on-surface-variant">Languages</h3>
        {(content.languages ?? []).map((lang, i) => (
          <div
            key={i}
            className="bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-md flex items-end gap-sm"
          >
            <div className="flex-1 flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">Language</label>
              <input
                type="text"
                value={lang.name}
                onChange={(e) => {
                  const updated = [...(content.languages ?? [])];
                  updated[i] = { ...updated[i], name: e.target.value };
                  updateContent({ languages: updated });
                }}
                placeholder="e.g. Spanish"
                className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
            <div className="flex-1 flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">Proficiency</label>
              <input
                type="text"
                value={lang.level}
                onChange={(e) => {
                  const updated = [...(content.languages ?? [])];
                  updated[i] = { ...updated[i], level: e.target.value };
                  updateContent({ languages: updated });
                }}
                placeholder="e.g. Native, B2, Proficient"
                className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
            <button
              onClick={() => {
                const updated = (content.languages ?? []).filter((_, idx) => idx !== i);
                updateContent({ languages: updated });
              }}
              aria-label="Remove language"
              className="flex items-center gap-xs text-label-sm text-error px-sm py-sm rounded-lg hover:bg-error-container/30 transition-colors"
            >
              <Trash size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            updateContent({ languages: [...(content.languages ?? []), { name: "", level: "" }] })
          }
          className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-dashed border-outline-variant text-primary text-label-md hover:bg-surface-container-low transition-colors"
        >
          + Add Language
        </button>
      </div>

      <div className="flex flex-col gap-md">
        <h3 className="text-label-caps text-on-surface-variant">Certifications</h3>
        <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant/20 flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant">
              Certifications <span className="font-normal">(one per line)</span>
            </label>
            <textarea
              value={(content.certifications ?? []).join("\n")}
              onChange={(e) =>
                updateContent({
                  certifications: e.target.value.split("\n").filter(Boolean),
                })
              }
              rows={3}
              placeholder="AWS Certified Solutions Architect&#10;PMP"
              className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-md">
        <h3 className="text-label-caps text-on-surface-variant">Awards</h3>
        <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant/20 flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant">
              Awards <span className="font-normal">(one per line)</span>
            </label>
            <textarea
              value={(content.awards ?? []).join("\n")}
              onChange={(e) =>
                updateContent({
                  awards: e.target.value.split("\n").filter(Boolean),
                })
              }
              rows={3}
              placeholder="Employee of the Year 2023"
              className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
