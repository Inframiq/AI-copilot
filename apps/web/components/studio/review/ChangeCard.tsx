"use client";
import { useState } from "react";
import {
  ArrowsClockwise,
  Check,
  PencilSimple,
  Sparkle,
  ArrowUUpLeft,
} from "@phosphor-icons/react";
import type { BulletChange } from "@/stores/tailoring-store";

// Importance was a small corner badge; as a colored left rail it reads at
// a glance while the eye is on the text, which is the point of a queue.
const RAIL: Record<string, string> = {
  high: "bg-primary",
  medium: "bg-secondary",
  low: "bg-outline-variant",
};

export function ChangeCard({
  change,
  importance,
  decision,
  landedKeywords,
  atsDelta,
  busy,
  onDecide,
  onRewrite,
  onEdit,
}: {
  change: BulletChange;
  importance?: string;
  decision?: "accept" | "reject";
  landedKeywords?: string[];
  atsDelta?: number;
  busy?: "rewrite" | "humanize" | null;
  onDecide: (d: "accept" | "reject") => void;
  onRewrite: (mode: "rewrite" | "humanize") => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(change.tailored);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== change.tailored) onEdit(next);
  }

  // overflow-clip, not overflow-hidden: it still clips the importance rail to
  // the rounded corner, but does not make the card a scroll container — which
  // would leave the sticky action row below with nothing to stick to.
  return (
    <article className="relative flex overflow-clip rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-lg">
      {importance && (
        <span
          aria-label={`${importance} impact`}
          className={`w-1.5 shrink-0 ${RAIL[importance.toLowerCase()] ?? RAIL.low}`}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col gap-md p-lg">
        <header className="flex items-center justify-between gap-sm">
          <p className="text-label-caps text-on-surface-variant truncate">
            {change.company} · {change.jobTitle}
          </p>
          {importance && (
            <span className="text-label-caps text-on-surface-variant shrink-0">
              {importance} impact
            </span>
          )}
        </header>

        <div className="flex flex-col gap-xs">
          <span className="text-label-caps text-on-surface-variant">Was</span>
          <p className="text-body-md leading-relaxed text-on-surface-variant">
            {change.original || <em className="not-italic opacity-50">— empty —</em>}
          </p>
        </div>

        <div className="h-px bg-outline-variant/30" />

        <div className="flex flex-col gap-xs">
          <div className="flex items-center justify-between gap-sm">
            <span className="text-label-caps text-primary">Now</span>
            {!editing && (
              <button
                type="button"
                aria-label="Edit tailored text"
                onClick={() => {
                  setDraft(change.tailored);
                  setEditing(true);
                }}
                className="flex items-center gap-xs text-caption text-on-surface-variant hover:text-primary transition-colors"
              >
                <PencilSimple size={13} />
                Edit
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
              }}
              rows={3}
              className="w-full px-md py-sm rounded-xl border border-primary/50 bg-surface text-body-md leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          ) : (
            <p className="text-body-md leading-relaxed text-on-surface">{change.tailored}</p>
          )}
        </div>

        {(landedKeywords?.length || atsDelta) ? (
          <div className="flex items-center gap-xs flex-wrap">
            {landedKeywords?.map((kw) => (
              <span
                key={kw}
                className="px-sm py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium"
              >
                {kw}
              </span>
            ))}
            {!!atsDelta && (
              <span className="tabular ml-auto text-caption font-bold text-success">
                ATS +{atsDelta}
              </span>
            )}
          </div>
        ) : null}

        {/* Below lg the card is taller than the viewport, so the verdict
            follows the text down instead of sitting off-screen under it. */}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-sm bg-surface-container-lowest/95 py-sm backdrop-blur-sm lg:static lg:bg-transparent lg:pb-0 lg:pt-xs lg:backdrop-blur-none">
          <button
            type="button"
            onClick={() => onDecide("reject")}
            className={`flex items-center gap-xs px-md py-sm rounded-xl text-label-md transition-all ${
              decision === "reject"
                ? "bg-on-surface text-surface"
                : "border border-outline-variant/50 text-on-surface-variant hover:border-on-surface hover:text-on-surface"
            }`}
          >
            <ArrowUUpLeft size={15} />
            Keep mine
          </button>

          <div className="flex items-center gap-xs ml-auto">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => onRewrite("rewrite")}
              title="Re-optimize this bullet for the JD"
              className="flex items-center gap-xs px-sm py-sm rounded-xl text-label-sm text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
            >
              <ArrowsClockwise size={14} className={busy === "rewrite" ? "animate-spin" : ""} />
              {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => onRewrite("humanize")}
              title="Make this bullet sound more natural"
              className="flex items-center gap-xs px-sm py-sm rounded-xl text-label-sm text-on-surface-variant hover:text-tertiary hover:bg-tertiary/5 transition-all disabled:opacity-40"
            >
              <Sparkle size={14} className={busy === "humanize" ? "animate-pulse" : ""} />
              {busy === "humanize" ? "Humanizing…" : "Humanize"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onDecide("accept")}
            className={`flex items-center gap-xs px-md py-sm rounded-xl text-label-md transition-all ${
              decision === "accept"
                ? "bg-primary text-on-primary shadow-sm"
                : "border border-primary/50 text-primary hover:bg-primary/5"
            }`}
          >
            <Check size={15} weight="bold" />
            Take it
          </button>
        </div>
      </div>
    </article>
  );
}
