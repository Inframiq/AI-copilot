"use client";
import { ArrowsClockwise, Sparkle, PaperPlaneRight, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { FOCUS_RING, PRESS } from "@/lib/focus";

/**
 * The professional summary. Every tailoring run writes one for the job
 * (services/summary_writer.py); a two-way toggle picks between it and the
 * user's own. One that failed a check starts on the user's own and says
 * why. Rewrite / Humanize / a custom instruction replace the new version.
 */
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
  flags,
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
  /** Why the summary tailoring wrote started switched off (its checks). */
  flags?: string[];
}) {
  if (!original.trim() && !tailored.trim()) return null;
  const changed = tailored.trim() !== original.trim();
  const usingRewrite = changed && decision !== "reject";
  const shown = usingRewrite ? tailored : original;

  return (
    <article aria-label="Professional summary" className="flex flex-col gap-md rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h3 className="text-body-lg font-semibold text-on-surface">Professional summary</h3>
        {changed && (
          <div role="group" aria-label="Which summary to use" className="flex rounded-xl bg-surface-container p-0.5">
            {(["reject", "accept"] as const).map((d) => {
              const active = d === "accept" ? usingRewrite : !usingRewrite;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onDecide(d)}
                  className={`rounded-lg px-md py-1 text-label-sm ${PRESS} ${FOCUS_RING} ${
                    active ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {d === "accept" ? "For this job" : original.trim() ? "Your original" : "None"}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className={`text-body-md leading-relaxed text-on-surface transition-opacity ${busy ? "opacity-50" : ""}`}>
        {shown || <em className="not-italic opacity-50">— empty —</em>}
      </p>

      {(flags?.length ?? 0) > 0 && (
        <p
          data-testid="summary-flags"
          className="flex items-start gap-xs rounded-xl bg-tertiary-container/60 px-sm py-xs text-caption text-on-tertiary-container"
        >
          <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            {usingRewrite ? "Check before you keep this — it" : "The summary for this job is off because it"}{" "}
            {flags!.join("; ")}.
          </span>
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-error-container px-sm py-xs text-caption text-on-error-container">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-xs border-t border-outline-variant/20 pt-sm">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => onRewrite("rewrite")}
          title="Rewrite it for this job — uses a credit"
          className={`flex items-center gap-xs rounded-xl px-sm py-xs text-label-sm text-on-surface-variant hover:bg-primary/10 hover:text-primary active:bg-primary/20 disabled:opacity-40 ${PRESS} ${FOCUS_RING}`}
        >
          <ArrowsClockwise size={14} className={busy === "rewrite" ? "animate-spin" : ""} />
          {busy === "rewrite" ? "Rewriting…" : "Rewrite for this job"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => onRewrite("humanize")}
          title="Make it sound more natural — uses a credit"
          className={`flex items-center gap-xs rounded-xl px-sm py-xs text-label-sm text-on-surface-variant hover:bg-tertiary/10 hover:text-tertiary active:bg-tertiary/20 disabled:opacity-40 ${PRESS} ${FOCUS_RING}`}
        >
          <Sparkle size={14} className={busy === "humanize" ? "animate-pulse" : ""} />
          {busy === "humanize" ? "Humanizing…" : "Humanize"}
        </button>
      </div>

      <form
        className="flex items-center gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim() && !busy) onRewrite("custom");
        }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label="How should the AI rewrite your summary?"
          placeholder="Or tell the AI how to rewrite it…"
          className="min-w-0 flex-1 rounded-xl border border-outline-variant/50 bg-surface px-md py-sm text-body-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="submit"
          disabled={!!busy || !prompt.trim()}
          aria-label="Apply custom rewrite"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary active:brightness-90 disabled:bg-surface-container disabled:text-on-surface-variant ${PRESS} ${FOCUS_RING}`}
        >
          {busy === "custom" ? (
            <CircleNotch size={16} className="animate-spin" />
          ) : (
            <PaperPlaneRight size={16} weight="fill" />
          )}
        </button>
      </form>
    </article>
  );
}
