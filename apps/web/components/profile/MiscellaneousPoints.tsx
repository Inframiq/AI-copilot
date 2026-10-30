"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileArrowUp, Trash, WarningCircle } from "@phosphor-icons/react";
import type { UnplacedSection } from "@career-copilot/types";
import { getCareerProfile, setMiscPoints, type CareerProfile } from "@/lib/career-profile-client";
import { miscGroupLabel, MISC_SECTION_LABEL, MISC_SECTIONS, type MiscPoint, type MiscSection } from "@/lib/misc-points";
import { FOCUS_RING, PRESS } from "@/lib/focus";

/**
 * The body of the profile's Miscellaneous section: the points saved from the
 * notes canvas, grouped by the section each was filed under — or, for an
 * uploaded résumé's points it couldn't place, by the heading they were
 * printed under ("Roles and Responsibilities"). Editing is free
 * (no AI) and saves at once — not through "Save Profile", which never writes
 * this column (see CareerProfileInput).
 *
 * `replacing`: a new résumé read on the Profile and not saved yet. Its
 * points are shown as added on save. The previous résumé's points (those
 * still under an upload's heading) stay unless the user marks them to go;
 * marked ones are removed with Save Profile, never before.
 */
export function MiscellaneousPoints({ replacing }: {
  replacing?: {
    incoming: UnplacedSection[];
    dropping: string[];
    onDrop: (ids: string[], drop: boolean) => void;
  };
} = {}) {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ["careerProfile"], queryFn: getCareerProfile });
  // Text being typed, by point id — saved on blur.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return null;
  const points = profile?.miscellaneous;
  // The previous résumé's points, and the new one's still to come.
  const previous = replacing && Array.isArray(points) ? points.filter((p) => typeof p.heading === "string") : [];
  const incoming = (replacing?.incoming ?? []).flatMap(({ heading, points: texts }) =>
    texts.map((text) => text.trim()).filter(Boolean).map((text) => ({ heading, text })));
  const allDropping = previous.length > 0 && previous.every((p) => replacing!.dropping.includes(p.id));
  const notice = replacing && (previous.length > 0 || incoming.length > 0) && (
    <div role="region" aria-label="Points from the new résumé"
      className="flex flex-col gap-sm rounded-xl border border-primary/20 bg-primary/[0.03] p-md">
      <div className="flex items-start gap-sm">
        <FileArrowUp size={18} className="mt-[2px] shrink-0 text-primary" />
        <p className="text-caption text-on-surface-variant">
          New résumé not saved yet. Its points are added with Save Profile.
          {previous.length > 0 && " The previous résumé's points stay unless marked to remove."}
        </p>
      </div>
      {previous.length > 0 && (
        <button type="button"
          onClick={() => replacing!.onDrop(previous.map((p) => p.id), !allDropping)}
          className={`self-start rounded-lg border border-outline-variant/50 px-sm py-xs text-label-sm font-semibold text-on-surface hover:bg-on-surface/5 ${PRESS} ${FOCUS_RING}`}>
          {allDropping ? "Keep all from the previous résumé" : "Remove all from the previous résumé on save"}
        </button>
      )}
      {incoming.length > 0 && (
        <div className="flex flex-col gap-xs">
          <h3 className="text-label-sm font-semibold text-primary">Added on save</h3>
          <ul className="flex flex-col gap-xs">
            {incoming.map(({ heading, text }, i) => (
              <li key={i} className="rounded-lg border border-dashed border-primary/30 px-sm py-xs text-body-sm text-on-surface">
                {text} <span className="text-caption text-on-surface-variant">· {heading}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
  if (!Array.isArray(points)) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        {profile ? "Saving notes to your profile isn't available yet." : "Save your profile once first."}
      </p>
    );
  }
  if (points.length === 0) {
    if (notice) return notice;
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

  const groups = MISC_SECTIONS.flatMap((section) => {
    const filed = points.filter((p) => p.section === section);
    return [...new Set(filed.map(miscGroupLabel))].map((label) => ({
      label,
      items: filed.filter((p) => miscGroupLabel(p) === label),
    }));
  });

  return (
    <div className="flex flex-col gap-lg">
      {notice}
      {groups.map(({ label, items }) => (
        <div key={label} className="flex flex-col gap-sm">
          <h3 className="text-label-md font-semibold text-on-surface-variant">{label}</h3>
          <ul className="flex flex-col gap-sm">
            {items.map((point) => {
              const fromPrevious = previous.includes(point);
              const dropping = fromPrevious && replacing!.dropping.includes(point.id);
              return (
              <li key={point.id} className={`flex flex-col gap-xs rounded-xl border p-sm sm:flex-row sm:items-start ${
                dropping ? "border-error/30 bg-error/[0.03]" : "border-outline-variant/30"}`}>
                {fromPrevious && (
                  <div className="flex items-center gap-xs sm:order-last">
                    <span className={`text-caption ${dropping ? "text-error font-semibold" : "text-on-surface-variant"}`}>
                      {dropping ? "Removed on save" : "Previous résumé"}
                    </span>
                    <button type="button"
                      aria-label={dropping ? `Keep: ${point.text}` : `Remove on save: ${point.text}`}
                      onClick={() => replacing!.onDrop([point.id], !dropping)}
                      className={`rounded-lg border border-outline-variant/50 px-sm py-xs text-label-sm font-semibold text-on-surface hover:bg-on-surface/5 ${PRESS} ${FOCUS_RING}`}>
                      {dropping ? "Keep" : "Remove on save"}
                    </button>
                  </div>
                )}
                <textarea
                  aria-label="Saved point"
                  value={drafts[point.id] ?? point.text}
                  onChange={(e) => setDrafts((d) => ({ ...d, [point.id]: e.target.value }))}
                  onBlur={() => commitText(point)}
                  disabled={saving}
                  rows={2}
                  className={`flex-1 resize-y rounded-lg border ${dropping ? "line-through opacity-60" : ""} border-outline-variant/40 bg-surface-container-lowest/80 px-sm py-xs text-body-sm text-on-surface ${FOCUS_RING}`}
                />
                <div className="flex items-center gap-xs">
                  <select
                    aria-label={`Section for: ${point.text}`}
                    value={point.section}
                    disabled={saving}
                    onChange={(e) =>
                      save(points.map((p) => {
                        if (p.id !== point.id) return p;
                        // Filed somewhere now: the upload's heading no longer describes it.
                        const { heading: _heading, ...rest } = p;
                        return { ...rest, section: e.target.value as MiscSection };
                      }))
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
              );
            })}
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
