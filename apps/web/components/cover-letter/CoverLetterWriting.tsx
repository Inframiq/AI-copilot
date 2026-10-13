"use client";
import { useEffect, useState } from "react";
import { Check, PenNib } from "@phosphor-icons/react";

/**
 * Paced to a typical run, like the tailoring progress: the letter comes
 * back in one piece with no progress of its own, so these stages are shown
 * in turn and the last stays open until the letter actually arrives.
 */
export const LETTER_STEPS = [
  { label: "Reading the job", at: 0 },
  { label: "Picking your strongest points", at: 4 },
  { label: "Writing the letter", at: 9 },
  { label: "Polishing the wording", at: 16 },
] as const;

// The page being written: greeting, three short paragraphs, sign-off.
// Widths vary so it reads as prose, not a progress bar.
const LINES: { w: string; gapBefore?: boolean }[] = [
  { w: "38%" },
  { w: "96%", gapBefore: true }, { w: "92%" }, { w: "64%" },
  { w: "94%", gapBefore: true }, { w: "98%" }, { w: "88%" }, { w: "52%" },
  { w: "90%", gapBefore: true }, { w: "70%" },
  { w: "26%", gapBefore: true }, { w: "34%" },
];

/** While a cover letter is being written: a page filling in line by line. */
export function CoverLetterWriting({ slow, onCheck }: { slow?: boolean; onCheck?: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  let current = 0;
  LETTER_STEPS.forEach((s, i) => { if (seconds >= s.at) current = i; });

  return (
    <div className="flex flex-col items-center gap-lg" aria-busy="true">
      <div className="flex flex-col items-center gap-xs text-center">
        <span className="cl-nib flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <PenNib size={24} weight="duotone" />
        </span>
        <h2 className="text-body-lg font-semibold text-on-surface">Writing your cover letter</h2>
        <p className="tabular text-caption text-on-surface-variant">{seconds}s</p>
      </div>

      {/* The page: lines draw in one after another, then start over. */}
      <div
        aria-hidden
        className="relative w-full max-w-[26rem] rounded-2xl border border-outline-variant/30 bg-surface-container-lowest px-lg py-xl shadow-lg shadow-on-surface/5"
      >
        <div className="flex flex-col">
          {LINES.map((line, i) => (
            <span
              key={i}
              className={`cl-line block h-2 rounded-full bg-on-surface/15 ${line.gapBefore ? "mt-md" : "mt-sm first:mt-0"}`}
              style={{ width: line.w, animationDelay: `${i * 0.45}s` }}
            />
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">{LETTER_STEPS[current].label}</p>
      <ol aria-hidden className="flex w-full max-w-[26rem] flex-col gap-xs">
        {LETTER_STEPS.slice(0, current + 1).map((step, i) => {
          const done = i < current;
          return (
            <li key={step.label} className="tp-step flex items-center gap-sm text-body-sm">
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                {done ? (
                  <span className="tp-check flex h-5 w-5 items-center justify-center rounded-full bg-primary text-on-primary">
                    <Check size={11} weight="bold" />
                  </span>
                ) : (
                  <>
                    <span className="tp-ring absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary" />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  </>
                )}
              </span>
              <span className={done ? "text-on-surface-variant" : "tp-shimmer font-semibold"}>{step.label}</span>
            </li>
          );
        })}
      </ol>

      {slow && (
        <div className="flex flex-col items-center gap-xs text-center">
          <p className="max-w-[24rem] text-body-sm text-on-surface-variant">
            This is taking longer than expected. It may already be done.
          </p>
          {onCheck && (
            <button onClick={onCheck} className="text-label-md text-primary hover:underline">
              Check again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
