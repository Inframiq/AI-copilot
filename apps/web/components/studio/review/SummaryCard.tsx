"use client";
import { ArrowsClockwise, Sparkle, PaperPlaneRight } from "@phosphor-icons/react";

export function SummaryCard({
  original,
  tailored,
  decision,
  busy,
  error,
  prompt,
  setPrompt,
  onDecide,
  onRewrite,
}: {
  original: string;
  tailored: string;
  decision?: "accept" | "reject";
  busy: "rewrite" | "humanize" | "custom" | null;
  error: string | null;
  prompt: string;
  setPrompt: (v: string) => void;
  onDecide: (d: "accept" | "reject") => void;
  onRewrite: (mode: "rewrite" | "humanize" | "custom") => void;
}) {
  if (!original.trim() && !tailored.trim()) return null;
  // Unlike bullets, the summary starts identical to the original — there is
  // nothing to review until the user explicitly asks for a rewrite.
  const changed = tailored.trim() !== original.trim();

  return (
    <article className="flex flex-col gap-md rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm">
      <h3 className="text-label-caps text-on-surface-variant">Professional Summary</h3>

      {changed && (
        <div className="flex flex-col gap-xs">
          <span className="text-label-caps text-on-surface-variant">Was</span>
          <p className="text-body-md leading-relaxed text-on-surface-variant">{original}</p>
        </div>
      )}

      <div className="flex flex-col gap-xs">
        <span className={`text-label-caps ${changed ? "text-primary" : "text-on-surface-variant"}`}>
          {changed ? "Now" : "Current"}
        </span>
        <p className="text-body-md leading-relaxed text-on-surface">
          {tailored || <em className="not-italic opacity-50">— empty —</em>}
        </p>
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      <div className="flex items-center gap-sm flex-wrap">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => onRewrite("rewrite")}
          className="flex items-center gap-xs px-sm py-xs rounded-xl text-label-sm text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
        >
          <ArrowsClockwise size={14} className={busy === "rewrite" ? "animate-spin" : ""} />
          {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => onRewrite("humanize")}
          className="flex items-center gap-xs px-sm py-xs rounded-xl text-label-sm text-on-surface-variant hover:text-tertiary hover:bg-tertiary/5 transition-all disabled:opacity-40"
        >
          <Sparkle size={14} className={busy === "humanize" ? "animate-pulse" : ""} />
          {busy === "humanize" ? "Humanizing…" : "Humanize"}
        </button>
        {changed && (
          <button
            type="button"
            onClick={() => onDecide(decision === "reject" ? "accept" : "reject")}
            className="ml-auto text-caption text-on-surface-variant hover:text-on-surface transition-colors"
          >
            {decision === "reject" ? "Use the rewrite" : "Keep my original"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-sm">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && prompt.trim() && !busy) onRewrite("custom");
          }}
          placeholder="Tell the AI how to rewrite it…"
          className="flex-1 px-md py-sm rounded-xl border border-outline-variant/50 bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
        <button
          type="button"
          disabled={!!busy || !prompt.trim()}
          onClick={() => onRewrite("custom")}
          aria-label="Apply custom rewrite"
          className="flex items-center gap-xs px-md py-sm rounded-xl text-label-sm text-primary border border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-40"
        >
          <PaperPlaneRight size={14} className={busy === "custom" ? "animate-pulse" : ""} />
        </button>
      </div>
    </article>
  );
}
