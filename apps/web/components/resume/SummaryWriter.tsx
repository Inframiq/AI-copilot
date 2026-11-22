"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleNotch, Sparkle, WarningCircle } from "@phosphor-icons/react";
import type { ResumeContent } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { wordCount } from "@/lib/misc-points";
import { FOCUS_RING, PRESS } from "@/lib/focus";

/** CREDIT_COSTS["write_summary"] in apps/api/app/core/credits.py. */
export const WRITE_SUMMARY_CREDITS = 3;

/**
 * "Generate / Regenerate with KripaX" under a summary box (Builder and
 * Profile): a professional summary written from what the page holds now,
 * saved or not, to the same rules and checks as the one every tailoring run
 * writes (services/summary_writer.py). The draft shows beside the user's
 * own and changes nothing until "Use this". With no summary yet, a short
 * prompt asks for one.
 */
export function SummaryWriter({
  current,
  getContent,
  onUse,
}: {
  /** The summary in the box now. */
  current: string;
  /** The résumé to write from, built when the button is pressed. */
  getContent: () => ResumeContent;
  onUse: (summary: string) => void;
}) {
  const queryClient = useQueryClient();
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState<{ summary: string; problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const has = current.trim().length > 0;

  async function write() {
    setWriting(true);
    setError(null);
    try {
      setDraft(await apiClient.writeSummary(getContent()));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't write a summary. Try again.");
    } finally {
      setWriting(false);
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    }
  }

  const button = (
    <button
      type="button"
      onClick={write}
      disabled={writing}
      title="Written from your roles, results and tools"
      className={`flex items-center gap-xs rounded-xl px-sm py-xs text-label-sm text-primary hover:bg-primary/10 active:bg-primary/20 disabled:opacity-50 ${PRESS} ${FOCUS_RING}`}
    >
      {writing ? <CircleNotch size={14} className="animate-spin" /> : <Sparkle size={14} />}
      {writing ? "Writing…" : has ? "Regenerate with KripaX" : "Generate with KripaX"}
      <span className="font-normal opacity-80">· uses {WRITE_SUMMARY_CREDITS} credits</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-sm">
      {has ? (
        <div className="flex flex-wrap items-center gap-sm">{button}</div>
      ) : (
        <div
          data-testid="summary-missing"
          className="flex flex-col gap-xs rounded-2xl border border-dashed border-outline-variant p-md sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-body-sm text-on-surface-variant">
            No professional summary yet. It is the first thing a recruiter reads.
          </p>
          {button}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-error-container px-sm py-xs text-caption text-on-error-container">
          {error}
        </p>
      )}
      {draft && (
        <div
          role="group"
          aria-label="Suggested summary"
          className="flex flex-col gap-sm rounded-2xl border border-primary/30 bg-primary/5 p-md"
        >
          <p className="text-label-caps text-on-surface-variant">Suggested summary · {wordCount(draft.summary)} words</p>
          <p className="text-body-md leading-relaxed text-on-surface">{draft.summary}</p>
          {draft.problems.length > 0 && (
            <p
              data-testid="write-summary-problems"
              className="flex items-start gap-xs rounded-xl bg-tertiary-container/60 px-sm py-xs text-caption text-on-tertiary-container"
            >
              <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
              <span>Check before you use this — it {draft.problems.join("; ")}.</span>
            </p>
          )}
          <div className="flex flex-wrap gap-xs">
            <button
              type="button"
              onClick={() => {
                onUse(draft.summary);
                setDraft(null);
              }}
              className={`rounded-xl bg-primary px-md py-xs text-label-sm font-semibold text-on-primary active:brightness-90 ${PRESS} ${FOCUS_RING}`}
            >
              Use this
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={`rounded-xl px-md py-xs text-label-sm text-on-surface-variant hover:bg-surface-container ${PRESS} ${FOCUS_RING}`}
            >
              {has ? "Keep mine" : "Dismiss"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
