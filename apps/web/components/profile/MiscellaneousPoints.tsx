"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash, WarningCircle } from "@phosphor-icons/react";
import { getCareerProfile, setMiscPoints, type CareerProfile } from "@/lib/career-profile-client";
import { MISC_SECTION_LABEL, MISC_SECTIONS, type MiscPoint, type MiscSection } from "@/lib/misc-points";
import { FOCUS_RING, PRESS } from "@/lib/focus";

/**
 * The body of the profile's Miscellaneous section: the points saved from the
 * notes canvas, grouped by the section each was filed under. Editing is free
 * (no AI) and saves at once — not through "Save Profile", which never writes
 * this column (see CareerProfileInput).
 */
export function MiscellaneousPoints() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ["careerProfile"], queryFn: getCareerProfile });
  // Text being typed, by point id — saved on blur.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return null;
  const points = profile?.miscellaneous;
  if (!Array.isArray(points)) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        {profile ? "Saving notes to your profile isn't available yet." : "Save your profile once first."}
      </p>
    );
  }
  if (points.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        Nothing here yet. When something about yourself comes to mind while you analyse a job or tailor a résumé,
        write it in the notes box there — it lands here, ready to add to any résumé you tailor.
      </p>
    );
  }

  async function save(next: MiscPoint[]) {
    setSaving(true);
    setError(null);
    try {
      const updated = await setMiscPoints(next);
      queryClient.setQueryData<CareerProfile | null>(["careerProfile"], updated);
      return true;
    } catch (err) {
      setError(`Couldn't save that${err instanceof Error && err.message ? ` — ${err.message}` : ""}. Try again.`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function commitText(point: MiscPoint) {
    const draft = drafts[point.id];
    if (draft === undefined) return;
    const text = draft.trim();
    // An emptied point goes back to what it was; deleting is its own button.
    if (text && text !== point.text) {
      if (!(await save(points!.map((p) => (p.id === point.id ? { ...p, text } : p))))) return;
    }
    setDrafts(({ [point.id]: _done, ...rest }) => rest);
  }

  const groups = MISC_SECTIONS.map((section) => ({
    section,
    items: points.filter((p) => p.section === section),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-lg">
      {groups.map(({ section, items }) => (
        <div key={section} className="flex flex-col gap-sm">
          <h3 className="text-label-md font-semibold text-on-surface-variant">{MISC_SECTION_LABEL[section]}</h3>
          <ul className="flex flex-col gap-sm">
            {items.map((point) => (
              <li key={point.id} className="flex flex-col gap-xs rounded-xl border border-outline-variant/30 p-sm sm:flex-row sm:items-start">
                <textarea
                  aria-label="Saved point"
                  value={drafts[point.id] ?? point.text}
                  onChange={(e) => setDrafts((d) => ({ ...d, [point.id]: e.target.value }))}
                  onBlur={() => commitText(point)}
                  disabled={saving}
                  rows={2}
                  className={`flex-1 resize-y rounded-lg border border-outline-variant/40 bg-surface-container-lowest/80 px-sm py-xs text-body-sm text-on-surface ${FOCUS_RING}`}
                />
                <div className="flex items-center gap-xs">
                  <select
                    aria-label={`Section for: ${point.text}`}
                    value={point.section}
                    disabled={saving}
                    onChange={(e) =>
                      save(points.map((p) => (p.id === point.id ? { ...p, section: e.target.value as MiscSection } : p)))
                    }
                    className={`rounded-lg border border-outline-variant/50 bg-surface px-sm py-xs text-caption text-on-surface ${FOCUS_RING}`}
                  >
                    {MISC_SECTIONS.map((s) => (
                      <option key={s} value={s}>
                        {MISC_SECTION_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Delete: ${point.text}`}
                    disabled={saving}
                    onClick={() => save(points.filter((p) => p.id !== point.id))}
                    className={`rounded-lg p-xs text-on-surface-variant hover:bg-error/10 hover:text-error disabled:opacity-50 ${PRESS} ${FOCUS_RING}`}
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {error && (
        <p role="alert" className="flex items-center gap-xs text-body-sm text-error">
          <WarningCircle size={16} weight="fill" /> {error}
        </p>
      )}
    </div>
  );
}
