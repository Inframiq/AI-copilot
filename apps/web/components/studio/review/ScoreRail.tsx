"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  Checks,
  CircleNotch,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { FOCUS_RING, PRESS } from "@/lib/focus";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Counts from the last shown value to `value`, so a re-score reads as the
 * number moving rather than a swap. Instant under reduced motion. */
export function useAnimatedNumber(value: number, duration = 650): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const next = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      shownRef.current = next;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

/** The most recent change to `value` — drives the "+4" pop and the glow.
 * Cleared after the animation so the same delta can pop again. */
function useDeltaPop(value: number | null): { delta: number; id: number } | null {
  const prev = useRef(value);
  const [pop, setPop] = useState<{ delta: number; id: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before === null || value === null || before === value) return;
    const id = Date.now();
    setPop({ delta: value - before, id });
    const t = setTimeout(() => setPop((p) => (p?.id === id ? null : p)), 1400);
    return () => clearTimeout(t);
  }, [value]);
  return pop;
}

function Arc({ from, to, r, c, className }: { from: number; to: number; r: number; c: number; className: string }) {
  const len = Math.max(0, ((to - from) / 100) * c);
  if (len <= 0) return null;
  return (
    <circle
      r={r}
      cx="50%"
      cy="50%"
      fill="none"
      strokeLinecap="butt"
      strokeDasharray={`${len} ${c}`}
      strokeDashoffset={-(from / 100) * c}
      className={`transition-[stroke-dasharray,stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none ${className}`}
    />
  );
}

/**
 * The live score. The base arc is the Before score in blue; the gain your
 * choices add over it lights up green (a loss shows in red). The number
 * counts to each new value and a "+N" rises off the dial.
 */
export function ScoreDial({ before, after, size = 176 }: { before: number; after: number; size?: number }) {
  const shown = useAnimatedNumber(after);
  const pop = useDeltaPop(after);
  const stroke = Math.round(size / 12);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const lo = Math.min(before, after);
  const hi = Math.max(before, after);
  const glow = pop ? (pop.delta > 0 ? "score-glow-up" : "score-glow-down") : "";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={`-rotate-90 ${glow}`}
        role="img"
        aria-label={`ATS match ${after} with your choices, ${before} before tailoring`}
        strokeWidth={stroke}
      >
        <circle r={r} cx="50%" cy="50%" fill="none" className="stroke-surface-container-high" />
        <Arc from={0} to={lo} r={r} c={c} className="stroke-primary" />
        {after > before && <Arc from={before} to={after} r={r} c={c} className="stroke-success" />}
        {after < before && <Arc from={after} to={before} r={r} c={c} className="stroke-error/60" />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="tabular font-bold leading-none tracking-tight text-on-surface"
          style={{ fontSize: size * 0.3 }}
        >
          {shown}
        </span>
        <span className="mt-1 text-label-caps text-on-surface-variant">ATS match</span>
      </div>
      {pop && (
        <span
          key={pop.id}
          aria-hidden
          className={`score-pop tabular absolute -right-2 top-1 rounded-full px-sm py-0.5 text-label-md font-bold shadow-md ${
            pop.delta > 0 ? "bg-success text-on-success" : "bg-error text-on-error"
          }`}
        >
          {pop.delta > 0 ? `+${pop.delta}` : `−${Math.abs(pop.delta)}`}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {pop ? `Score ${pop.delta > 0 ? "up" : "down"} ${Math.abs(pop.delta)} to ${after}` : ""}
      </span>
    </div>
  );
}

/** Spends a credit on click, so the first click arms it and the second
 * fires; it disarms itself after a few seconds. */
function TryAnotherButton({ onTryAnother, className = "" }: { onTryAnother: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onTryAnother();
        } else setArmed(true);
      }}
      className={`flex items-center justify-center gap-xs rounded-xl px-md py-sm text-label-sm ${PRESS} ${FOCUS_RING} ${
        armed
          ? "bg-tertiary-container text-on-tertiary-container"
          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
      } ${className}`}
    >
      <ArrowsClockwise size={14} />
      {armed ? "Uses a credit — click to confirm" : "Try another version"}
    </button>
  );
}

export interface ScoreRailProps {
  before: number | null;
  after: number | null;
  updating: boolean;
  stale: boolean;
  onRetryScore: () => void;
  pointsOn: number;
  pointsTotal: number;
  skillsAdded: number;
  onAutoSelect: () => void;
  onClear: () => void;
  onApply: () => void;
  canApply: boolean;
  onTryAnother: () => void;
  reusedRun: boolean;
}

function ScoreStatus({ updating, stale, onRetryScore }: Pick<ScoreRailProps, "updating" | "stale" | "onRetryScore">) {
  if (stale) {
    return (
      <button
        type="button"
        onClick={onRetryScore}
        className={`flex items-center gap-1 rounded-full bg-error-container px-sm py-0.5 text-caption text-on-error-container ${PRESS} ${FOCUS_RING}`}
      >
        <WarningCircle size={12} weight="fill" /> Score didn’t update — retry
      </button>
    );
  }
  return (
    <span
      className={`flex h-5 items-center gap-1 text-caption text-on-surface-variant transition-opacity ${
        updating ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden={!updating}
    >
      <CircleNotch size={12} className="animate-spin motion-reduce:animate-none" /> Updating…
    </span>
  );
}

/** Desktop: the sticky left rail. Everything that answers "what will I get
 * if I apply now?" in one place that never scrolls away. */
export function ScoreRail(props: ScoreRailProps) {
  const { before, after, pointsOn, pointsTotal, skillsAdded } = props;
  const lift = before !== null && after !== null ? after - before : null;

  return (
    <div className="flex flex-col gap-lg rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-[0_10px_40px_-18px_rgba(27,58,143,0.35)]">
      {before !== null && after !== null && (
        <div className="flex flex-col items-center gap-sm">
          <ScoreDial before={before} after={after} />
          <p className="flex items-center gap-xs text-body-sm text-on-surface-variant">
            <span className="tabular">Before {before}</span>
            <ArrowRight size={12} />
            <span className="tabular font-semibold text-on-surface">{after} with your choices</span>
          </p>
          {lift !== null && lift !== 0 && (
            <span
              className={`tabular rounded-full px-sm py-0.5 text-label-sm font-semibold ${
                lift > 0 ? "bg-success-container text-on-success-container" : "bg-error-container text-on-error-container"
              }`}
            >
              {lift > 0 ? `+${lift}` : `−${Math.abs(lift)}`} from tailoring
            </span>
          )}
          <ScoreStatus {...props} />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-sm">
        <div className="rounded-2xl bg-surface-container-low p-sm text-center">
          <dt className="text-caption text-on-surface-variant">Points on</dt>
          <dd className="tabular text-headline-md font-semibold text-on-surface">
            {pointsOn}<span className="text-body-sm font-normal text-on-surface-variant">/{pointsTotal}</span>
          </dd>
        </div>
        <div className="rounded-2xl bg-surface-container-low p-sm text-center">
          <dt className="text-caption text-on-surface-variant">Skills added</dt>
          <dd className="tabular text-headline-md font-semibold text-on-surface">{skillsAdded}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-xs">
        <button
          type="button"
          onClick={props.onAutoSelect}
          title="Turns on every point built on your own bullets. AI-written points stay as they are."
          className={`flex items-center justify-center gap-xs rounded-xl bg-primary/10 px-md py-sm text-label-md font-semibold text-primary hover:bg-primary/15 active:bg-primary/25 ${PRESS} ${FOCUS_RING}`}
        >
          <Checks size={16} weight="bold" /> Auto-select points
        </button>
        <button
          type="button"
          onClick={props.onClear}
          className={`flex items-center justify-center gap-xs rounded-xl px-md py-sm text-label-md text-on-surface-variant hover:bg-surface-container hover:text-on-surface active:bg-surface-container-high ${PRESS} ${FOCUS_RING}`}
        >
          <X size={16} /> Clear all
        </button>
      </div>

      <div className="flex flex-col gap-xs border-t border-outline-variant/30 pt-lg">
        <button
          type="button"
          onClick={props.onApply}
          disabled={!props.canApply}
          className={`group flex items-center justify-center gap-sm rounded-2xl bg-primary px-lg py-md text-label-md font-semibold text-on-primary shadow-[0_8px_24px_-10px_rgba(27,58,143,0.7)] hover:shadow-[0_12px_28px_-10px_rgba(27,58,143,0.8)] active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 ${PRESS} ${FOCUS_RING}`}
        >
          Apply &amp; Preview
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
        <TryAnotherButton onTryAnother={props.onTryAnother} />
        <p className="text-center text-caption text-on-surface-variant">
          {props.reusedRun
            ? "Same résumé, job and settings as last time — this is that result, no credit used."
            : "The same résumé and job always return this result."}
        </p>
      </div>
    </div>
  );
}

/** Phones and tablets: the same answer, pinned to the bottom edge. */
export function ScoreDock(props: ScoreRailProps) {
  const { before, after } = props;
  const shown = useAnimatedNumber(after ?? 0);
  const pop = useDeltaPop(after);
  return (
    <div className="flex items-center gap-sm">
      {before !== null && after !== null && (
        <div
          className="flex min-w-0 items-baseline gap-xs whitespace-nowrap"
          aria-label={`ATS match ${after} with your choices, ${before} before tailoring`}
        >
          <span className="tabular text-headline-md font-bold text-on-surface">{shown}</span>
          <span className="tabular text-caption text-on-surface-variant">before {before}</span>
          {pop && (
            <span
              key={pop.id}
              aria-hidden
              className={`score-pop tabular rounded-full px-xs text-caption font-bold ${
                pop.delta > 0 ? "bg-success text-on-success" : "bg-error text-on-error"
              }`}
            >
              {pop.delta > 0 ? `+${pop.delta}` : `−${Math.abs(pop.delta)}`}
            </span>
          )}
        </div>
      )}
      {/* Only when there is something to say — a reserved-but-empty slot
          squeezed the score off a phone-width bar. */}
      {(props.stale || props.updating) && <ScoreStatus {...props} />}
      <button
        type="button"
        onClick={props.onApply}
        disabled={!props.canApply}
        className={`ml-auto flex shrink-0 items-center gap-xs rounded-xl bg-primary px-md py-sm text-label-md font-semibold text-on-primary active:brightness-90 disabled:opacity-50 ${PRESS} ${FOCUS_RING}`}
      >
        Apply &amp; Preview <ArrowRight size={16} />
      </button>
    </div>
  );
}
