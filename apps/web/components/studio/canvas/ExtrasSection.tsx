"use client";
import { useResumeStore } from "@/stores/resume-store";
import { Trash } from "@phosphor-icons/react";
import { LINE_SECTIONS, SECTION_INFO } from "@/lib/profile-sections";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { LinesTextarea } from "./LinesTextarea";
import { repeatedAt } from "@/lib/duplicates";

// Languages, Certifications, and every one-per-line section the Profile
// holds too — a section added there is edited here as well.
export function ExtrasSection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  if (!content) return null;
  const repeatedLanguages = repeatedAt((content.languages ?? []).map((l) => l.name));
  // A certification named twice is flagged, not removed: a renewal is real.
  const repeatedCerts = repeatedAt(content.certifications ?? []);

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
              <SuggestInput
                kind="language"
                aria-label={`Language ${i + 1}`}
                value={lang.name}
                onValueChange={(name) => {
                  const updated = [...(content.languages ?? [])];
                  updated[i] = { ...updated[i], name };
                  updateContent({ languages: updated });
                }}
                exclude={(content.languages ?? []).filter((_, idx) => idx !== i).map((l) => l.name)}
                aria-invalid={repeatedLanguages.has(i) || undefined}
                placeholder="e.g. Spanish"
                className={`w-full px-sm py-xs rounded-lg border bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                  repeatedLanguages.has(i) ? "border-error" : "border-outline-variant/50"
                }`}
              />
              {repeatedLanguages.has(i) && <p className="text-caption text-error">Already listed.</p>}
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
        {/* One field each, so each can suggest the certification's own name. */}
        {(content.certifications ?? []).map((cert, i) => (
          <div key={i} className="flex flex-col gap-xs">
          <div className="flex items-center gap-sm">
            <SuggestInput
              kind="certification"
              aria-label={`Certification ${i + 1}`}
              value={cert}
              onValueChange={(name) => {
                const updated = [...(content.certifications ?? [])];
                updated[i] = name;
                updateContent({ certifications: updated });
              }}
              exclude={(content.certifications ?? []).filter((_, idx) => idx !== i)}
              aria-invalid={repeatedCerts.has(i) || undefined}
              placeholder="e.g. AWS Certified Solutions Architect – Associate"
              className={`flex-1 min-w-0 px-sm py-xs rounded-lg border bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all ${
                repeatedCerts.has(i) ? "border-error" : "border-outline-variant/50"
              }`}
            />
            <button
              onClick={() =>
                updateContent({ certifications: (content.certifications ?? []).filter((_, idx) => idx !== i) })
              }
              aria-label={`Remove certification ${i + 1}`}
              className="flex items-center text-label-sm text-error px-sm py-sm rounded-lg hover:bg-error-container/30 transition-colors"
            >
              <Trash size={14} />
            </button>
          </div>
          {repeatedCerts.has(i) && (
            <p className="text-caption text-error">Already listed. A renewal can stay; otherwise remove one.</p>
          )}
          </div>
        ))}
        <button
          onClick={() => updateContent({ certifications: [...(content.certifications ?? []), ""] })}
          className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-dashed border-outline-variant text-primary text-label-md hover:bg-surface-container-low transition-colors"
        >
          + Add Certification
        </button>
      </div>

      {/* Awards, Achievements, Leadership, Volunteer, Interests — the same
          sections the Profile holds (lib/profile-sections.ts). */}
      {LINE_SECTIONS.map((key) => (
        <div key={key} className="flex flex-col gap-md">
          <h3 className="text-label-caps text-on-surface-variant">{SECTION_INFO[key].label}</h3>
          <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant/20 flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <label htmlFor={`extras-${key}`} className="text-label-sm text-on-surface-variant">
                {SECTION_INFO[key].label} <span className="font-normal">(one per line)</span>
              </label>
              <LinesTextarea
                id={`extras-${key}`}
                lines={content[key] ?? []}
                onChange={(lines) => updateContent({ [key]: lines })}
                placeholder={SECTION_INFO[key].placeholder}
              />
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
