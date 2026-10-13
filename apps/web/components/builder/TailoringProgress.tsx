"use client";
import { useEffect, useState } from "react";
import { Check } from "@phosphor-icons/react";
import { TailoringStar } from "./TailoringStar";

/**
 * The pipeline's five stages, each with the second it starts at.
 *
 * Tailoring is one request (about 35 s on average) and reports no progress,
 * so these are paced to a typical run rather than read from it: each stage
 * appears in turn, is worked on, then ticks off. The last one never ticks —
 * it stays in progress until the result actually arrives, so a slow run
 * never shows everything finished while it is still going.
 */
export const TAILORING_STEPS = [
  { label: "Reading the job description", at: 0 },
  { label: "Matching it to your experience", at: 5 },
  { label: "Rewriting the relevant bullets", at: 11 },
  { label: "Fact-checking every rewrite", at: 23 },
  { label: "Scoring the result", at: 31 },
] as const;

/** Past this, the open stage says the run is slower than usual. */
const SLOW_AFTER = 60;

/** While the pipeline runs: the five stages, one after another. */
export function TailoringProgress() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // The stage in progress; everything before it is done, after it not shown.
  let current = 0;
  TAILORING_STEPS.forEach((s, i) => { if (seconds >= s.at) current = i; });
  const last = TAILORING_STEPS.length - 1;
  // Fills one fifth per finished stage, and creeps within the open one.
  const next = current < last ? TAILORING_STEPS[current + 1].at : TAILORING_STEPS[last].at + 30;
  const within = Math.min(1, (seconds - TAILORING_STEPS[current].at) / (next - TAILORING_STEPS[current].at));
  const progress = Math.min(0.96, (current + within * 0.9) / TAILORING_STEPS.length);

  return (
    <div className="flex flex-col gap-lg" aria-busy="true">
      <div className="flex flex-col items-center gap-sm rounded-3xl border border-outline-variant/30 bg-surface-container-lowest px-lg py-xl shadow-sm">
        <TailoringStar />
        <p className="text-body-lg font-semibold text-on-surface">Tailoring your résumé</p>
        <p className="tabular text-caption text-on-surface-variant">{seconds}s · usually 30–90 seconds</p>

        <div
          role="progressbar"
          aria-label="Tailoring progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="relative mt-xs h-1.5 w-full max-w-[20rem] overflow-hidden rounded-full bg-surface-container-high"
        >
          <div
            className="tp-bar h-full rounded-full bg-primary transition-[width] duration-1000 ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <p className="sr-only" aria-live="polite">{TAILORING_STEPS[current].label}</p>

        <ol className="mt-sm flex w-full max-w-[20rem] flex-col" aria-hidden>
          {TAILORING_STEPS.slice(0, current + 1).map((step, i) => {
            const done = i < current;
            return (
              <li key={step.label} className="tp-step relative flex gap-sm pb-md last:pb-0">
                {/* The rail to the next stage, filled once this one is done. */}
                {i < current && (
                  <span className="absolute left-[11px] top-6 bottom-0 w-0.5 rounded-full bg-primary/30" />
                )}
                <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
                  {done ? (
                    <span className="tp-check flex h-6 w-6 items-center justify-center rounded-full bg-primary text-on-primary">
                      <Check size={13} weight="bold" />
                    </span>
                  ) : (
                    <>
                      <span className="tp-ring absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary" />
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    </>
                  )}
                </span>
                <div className="flex min-w-0 flex-col pt-[2px] text-left">
                  <span
                    className={`text-body-sm ${
                      done ? "text-on-surface-variant" : "tp-shimmer font-semibold text-on-surface"
                    }`}
                  >
                    {step.label}
                  </span>
                  {!done && i === last && seconds >= SLOW_AFTER && (
                    <span className="text-caption text-on-surface-variant">Taking longer than usual. Still working.</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden className="flex flex-col gap-sm rounded-3xl border border-outline-variant/20 p-lg">
          <div className="skeleton h-4 w-40 rounded-full" />
          <div className="skeleton h-4 w-full rounded-full" />
          <div className="skeleton h-4 w-2/3 rounded-full" />
        </div>
      ))}
    </div>
  );
}
