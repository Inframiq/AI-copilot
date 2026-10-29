"use client";
import { useState } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { Trash } from "@phosphor-icons/react";
import { LINE_SECTIONS, SECTION_INFO } from "@/lib/profile-sections";

const textareaCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

const toLines = (text: string) => text.split("\n").filter((line) => line.trim());

/**
 * A list edited as one line per item. The text is kept as typed — rebuilding
 * it from the saved lines on every keystroke dropped the empty line Enter
 * had just made, so a second item could never be started at the end. The
 * store gets the non-empty lines; a change from outside (an undo, a tailor)
 * replaces the draft.
 */
function LinesTextarea({ id, lines, onChange, placeholder }: {
  id: string;
  lines: string[];
  onChange: (lines: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(lines.join("\n"));
  const joined = lines.join("\n");
  if (toLines(draft).join("\n") !== joined) setDraft(joined);
  return (
    <textarea
      id={id}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(toLines(e.target.value));
      }}
      rows={3}
      placeholder={placeholder}
      className={textareaCls}
    />
  );
}

// Languages, Certifications, and every one-per-line section the Profile
// holds too — a section added there is edited here as well.
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
            <label htmlFor="extras-certifications" className="text-label-sm text-on-surface-variant">
              Certifications <span className="font-normal">(one per line)</span>
            </label>
            <LinesTextarea
              id="extras-certifications"
              lines={content.certifications ?? []}
              onChange={(certifications) => updateContent({ certifications })}
              placeholder={"AWS Certified Solutions Architect\nPMP"}
            />
          </div>
        </div>
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
