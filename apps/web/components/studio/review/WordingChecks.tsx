"use client";
import { useState } from "react";
import { Hash, Repeat } from "@phosphor-icons/react";
import { FOCUS_RING, PRESS } from "@/lib/focus";
import type { NumberGap, Repeated } from "@/lib/wording-checks";

/**
 * The two things résumé checkers flag that the ATS score does not measure.
 *
 * Numbers: the AI may never invent one, so each bullet without a figure
 * comes with a question, and the user writes their real number into the
 * bullet here. Repetition: overused opening verbs and phrases across the
 * résumé as the current picks would produce it.
 *
 * Renders nothing when there is nothing to fix.
 */
export function WordingChecks({
  gaps,
  quantified,
  repetition,
  onSaveBullet,
}: {
  gaps: NumberGap[];
  /** Share of bullets carrying a number, 0..1. */
  quantified: number;
  repetition: { verbs: Repeated[]; phrases: Repeated[] };
  /** The user's own new text for a bullet. Theirs, so never flagged. */
  onSaveBullet: (key: string, text: string) => void;
}) {
  const repeated = repetition.verbs.length + repetition.phrases.length > 0;
  if (gaps.length === 0 && !repeated) return null;

  return (
    <section aria-label="Wording checks" className="flex flex-col gap-md">
      {gaps.length > 0 && (
        <article
          aria-label="Add numbers"
          className="flex flex-col gap-md rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm"
        >
          <header className="flex flex-col gap-xs">
            <h3 className="flex items-center gap-sm text-body-lg font-semibold text-on-surface">
              <Hash size={18} className="text-primary" />
              Add numbers
              <span className="tabular text-caption font-normal text-on-surface-variant">
                {Math.round(quantified * 100)}% of bullets have one
              </span>
            </h3>
            <p className="text-body-sm text-on-surface-variant">
              Recruiters and résumé checkers look for measured results. We never make figures up —
              if you know the real number, add it.
            </p>
          </header>
          <ul className="flex flex-col gap-sm">
            {gaps.map((gap) => (
              <NumberRow key={gap.key} gap={gap} onSave={(t) => onSaveBullet(gap.key, t)} />
            ))}
          </ul>
        </article>
      )}

      {repeated && (
        <article
          aria-label="Repeated wording"
          className="flex flex-col gap-sm rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm"
        >
          <h3 className="flex items-center gap-sm text-body-lg font-semibold text-on-surface">
            <Repeat size={18} className="text-primary" />
            Repeated wording
          </h3>
          <p className="text-body-sm text-on-surface-variant">
            Used in three or more bullets. Vary a few to read stronger — edit a point above, or
            switch off a rewrite that adds the repeat.
          </p>
          <ul className="flex flex-wrap gap-xs">
            {repetition.verbs.map((v) => (
              <li
                key={`v:${v.text}`}
                className="rounded-md bg-tertiary-container px-sm py-0.5 text-caption text-on-tertiary-container"
              >
                <span className="font-semibold capitalize">{v.text}</span> opens {v.count} bullets
              </li>
            ))}
            {repetition.phrases.map((p) => (
              <li
                key={`p:${p.text}`}
                className="rounded-md bg-tertiary-container px-sm py-0.5 text-caption text-on-tertiary-container"
              >
                “<span className="font-semibold">{p.text}</span>” in {p.count} bullets
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}

function NumberRow({ gap, onSave }: { gap: NumberGap; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(gap.text);

  function save() {
    const next = draft.trim();
    if (next && next !== gap.text.trim()) onSave(next);
    setEditing(false);
  }

  return (
    <li className="flex flex-col gap-xs rounded-2xl border border-outline-variant/20 p-md">
      {gap.where && <p className="text-caption text-on-surface-variant">{gap.where}</p>}
      {editing ? (
        <textarea
          autoFocus
          aria-label="Bullet with your number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          }}
          rows={2}
          className="w-full resize-none rounded-xl border border-primary/50 bg-surface px-sm py-xs text-body-md leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <p className="text-body-md leading-relaxed text-on-surface">{gap.text}</p>
      )}
      <p className="text-body-sm font-medium text-primary">{gap.question}</p>
      <div className="flex gap-xs">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              className={`rounded-xl bg-primary px-md py-xs text-label-sm text-on-primary ${PRESS} ${FOCUS_RING}`}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(gap.text);
                setEditing(false);
              }}
              className={`rounded-xl px-md py-xs text-label-sm text-on-surface-variant hover:bg-surface-container ${PRESS} ${FOCUS_RING}`}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(gap.text);
              setEditing(true);
            }}
            className={`rounded-xl border border-primary/40 px-md py-xs text-label-sm text-primary hover:bg-primary/5 ${PRESS} ${FOCUS_RING}`}
          >
            Add my number
          </button>
        )}
      </div>
    </li>
  );
}
