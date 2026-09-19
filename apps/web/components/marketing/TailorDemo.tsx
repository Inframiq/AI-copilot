"use client";
import { useEffect, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { CheckCircle, Warning } from "@phosphor-icons/react";

/**
 * The hero's working miniature of the review screen: three real rewrites,
 * each with its own switch, and the ATS score moving as they are switched —
 * the product's core loop, demonstrated rather than described.
 *
 * The figures are an example and labelled as one; nothing here claims to be a
 * measured result.
 */

interface DemoPoint {
  id: string;
  label: "Reworded" | "Adds a JD term";
  before: string;
  /** Tailored text, split so the JD phrase can be highlighted. */
  after: [string, string, string];
  points: number;
  startsOn: boolean;
  flag?: string;
}

const POINTS: DemoPoint[] = [
  {
    id: "roadmap",
    label: "Reworded",
    before: "Worked with the product team to plan quarterly engineering priorities",
    after: ["Partnered with product on ", "roadmap prioritisation", " for quarterly engineering plans"],
    points: 6,
    startsOn: true,
  },
  {
    id: "cicd",
    label: "Reworded",
    before: "Set up automated deployment pipelines that cut release time from 2 hours to 15 minutes",
    after: ["Automated releases with ", "CI/CD pipelines", ", cutting release time from 2 hours to 15 minutes"],
    points: 5,
    startsOn: true,
  },
  {
    id: "k8s",
    label: "Adds a JD term",
    before: "Moved our services onto the new cluster",
    after: ["Migrated services onto ", "Kubernetes", " for the new cluster"],
    points: 7,
    startsOn: false,
    flag: "Kubernetes isn't on your résumé. Switch this on only if it's true.",
  },
];

const BASE_SCORE = 58;
const RING = 2 * Math.PI * 42;

export function TailorDemo() {
  const reduce = useReducedMotion();
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(POINTS.map((p) => [p.id, p.startsOn])),
  );
  const target = BASE_SCORE + POINTS.reduce((sum, p) => sum + (on[p.id] ? p.points : 0), 0);

  // The score counts from the "before" figure on arrival, then follows the
  // switches. A motion value, so the ring and the digits never re-render the
  // whole card on every frame.
  const score = useMotionValue(reduce ? target : BASE_SCORE);
  const shown = useTransform(score, (v) => Math.round(v));
  const dash = useTransform(score, (v) => RING - (RING * v) / 100);
  const [digits, setDigits] = useState(reduce ? target : BASE_SCORE);

  useEffect(() => shown.on("change", setDigits), [shown]);
  useEffect(() => {
    if (reduce) {
      score.set(target);
      return;
    }
    const controls = animate(score, target, { duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 });
    return () => controls.stop();
  }, [target, reduce, score]);

  const lift = target - BASE_SCORE;

  return (
    <div className="relative">
      {/* Environmental light behind the window. */}
      <div
        aria-hidden
        className="absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(60%_60%_at_60%_40%,rgba(42,79,181,0.22),transparent_70%)] blur-2xl"
      />
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 24, rotateX: 6 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        style={{ transformPerspective: 1200 }}
        className="overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/80 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_30px_80px_-24px_rgba(27,58,143,0.35),0_12px_32px_-12px_rgba(23,24,29,0.18)] backdrop-blur-xl"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-sm border-b border-outline-variant/40 px-lg py-sm">
          <span aria-hidden className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-outline-variant" />
            <span className="h-2.5 w-2.5 rounded-full bg-outline-variant" />
            <span className="h-2.5 w-2.5 rounded-full bg-outline-variant" />
          </span>
          <span className="ml-xs text-caption font-medium text-on-surface-variant">
            Review · Senior Backend Engineer
          </span>
          <span className="ml-auto rounded-full bg-surface-container px-sm py-0.5 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Example
          </span>
        </div>

        <div className="grid gap-lg p-lg sm:grid-cols-[9.5rem_minmax(0,1fr)]">
          {/* Score */}
          <div className="flex flex-row items-center gap-md sm:flex-col sm:items-start">
            <div className="relative h-28 w-28 shrink-0">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" className="stroke-surface-container-high" />
                <motion.circle
                  cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round"
                  className="stroke-primary"
                  strokeDasharray={RING}
                  style={{ strokeDashoffset: dash }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="tabular text-[28px] font-bold leading-none text-on-surface" aria-hidden>
                  {digits}
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
                  ATS score
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {/* One announcement per change, not one per animation frame. */}
              <p className="sr-only" aria-live="polite">ATS score {target}</p>
              <p className="text-caption text-on-surface-variant">
                Was <span className="tabular font-semibold text-on-surface">{BASE_SCORE}</span>
              </p>
              <p className="tabular text-body-sm font-semibold text-success">+{lift} with your picks</p>
            </div>
            {/* Why the number moved: the job's terms, matched as points go on. */}
            <div className="hidden flex-col gap-xs border-t border-outline-variant/40 pt-md sm:flex sm:w-full">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
                Job terms
              </p>
              <ul className="flex flex-col gap-1.5">
                {POINTS.map((p) => (
                  <li
                    key={p.id}
                    className={`flex items-center gap-xs text-caption transition-colors duration-300 ${
                      on[p.id] ? "text-on-surface" : "text-on-surface-variant/70"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold transition-colors duration-300 ${
                        on[p.id] ? "bg-success text-white" : "bg-surface-container-high text-on-surface-variant"
                      }`}
                    >
                      {on[p.id] ? "✓" : ""}
                    </span>
                    {p.after[1]}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Points */}
          <ul className="flex flex-col gap-sm">
            {POINTS.map((p, i) => (
              <DemoCard
                key={p.id}
                point={p}
                on={on[p.id]}
                index={i}
                reduce={!!reduce}
                onToggle={() => setOn((s) => ({ ...s, [p.id]: !s[p.id] }))}
              />
            ))}
          </ul>
        </div>
      </motion.div>
      <p className="mt-md text-center text-caption text-on-surface-variant">
        Try the switches — the score follows your choices, like the real review.
      </p>
    </div>
  );
}

function DemoCard({
  point,
  on,
  index,
  reduce,
  onToggle,
}: {
  point: DemoPoint;
  on: boolean;
  index: number;
  reduce: boolean;
  onToggle: () => void;
}) {
  const flagged = !!point.flag;
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.55 + index * 0.12 }}
      className={`rounded-2xl border p-md transition-[background-color,border-color,box-shadow] duration-300 ${
        on
          ? "border-primary/25 bg-white shadow-[0_8px_24px_-12px_rgba(27,58,143,0.35)]"
          : "border-outline-variant/50 bg-surface-container-low/70"
      }`}
    >
      <div className="mb-xs flex items-center gap-sm">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-sm py-0.5 text-[11px] font-semibold ${
            flagged ? "bg-tertiary-fixed text-tertiary" : "bg-success-container text-success"
          }`}
        >
          {flagged ? <Warning size={11} weight="fill" /> : <CheckCircle size={11} weight="fill" />}
          {point.label}
        </span>
        <span className={`tabular text-caption font-semibold ${on ? "text-primary" : "text-on-surface-variant"}`}>
          +{point.points} pts
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`Use this rewrite: ${point.after.join("")}`}
          onClick={onToggle}
          className={`relative ml-auto h-6 w-11 shrink-0 rounded-full transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            on ? "bg-primary" : "bg-outline-variant"
          }`}
        >
          <motion.span
            aria-hidden
            layout={!reduce}
            transition={{ type: "spring", stiffness: 500, damping: 38 }}
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm ${on ? "right-0.5" : "left-0.5"}`}
          />
        </button>
      </div>
      <p className={`text-body-sm leading-relaxed transition-colors ${on ? "text-on-surface" : "text-on-surface-variant"}`}>
        {point.after[0]}
        <mark className="rounded bg-primary-fixed px-0.5 font-medium text-on-primary-fixed">{point.after[1]}</mark>
        {point.after[2]}
      </p>
      <p className="mt-1 text-caption text-on-surface-variant/80 line-through decoration-outline-variant">
        {point.before}
      </p>
      {flagged && (
        <p className="mt-sm flex items-start gap-xs rounded-xl bg-tertiary-fixed/60 px-sm py-1.5 text-caption text-tertiary">
          <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
          {point.flag}
        </p>
      )}
    </motion.li>
  );
}
