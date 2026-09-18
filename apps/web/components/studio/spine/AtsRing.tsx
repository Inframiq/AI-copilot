"use client";
import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

// The ATS score is the single most motivating number in the product; the
// old UI rendered it at 11px in three different places. Here it gets one
// home, at size, with the ring and the number animating to any projected
// value so a decision in the triage deck reads as visible progress.
//
// It also carries what the removed ScoreLift said, rather than a second score
// display being added beside it:
//   * `shown` prefers the projected score over the raw one, so the figure
//     always describes the résumé actually on screen.
//   * `before` is the pre-tailoring score; the chip shows the before → now
//     gain, which is the product's core claim and was otherwise invisible.
//   * `stale` flags a re-score that failed — swallowing it leaves a number
//     that looks current but no longer matches the user's selections.
export function AtsRing({
  score,
  projected,
  before = null,
  stale = false,
  size = 52,
}: {
  score: number | null;
  projected: number | null;
  before?: number | null;
  stale?: boolean;
  size?: number;
}) {
  const shown = projected ?? score;
  // The before → now lift is the headline. Until a pre-tailoring score exists
  // the chip falls back to the pending-selection delta, which is the only
  // movement there is to report.
  const lift = shown !== null && before !== null ? shown - before : null;
  const pendingDelta = score !== null && projected !== null ? projected - score : 0;
  const delta = lift !== null ? lift : pendingDelta;

  const value = useMotionValue(shown ?? 0);
  const spring = useSpring(value, { stiffness: 120, damping: 22 });
  const display = useTransform(spring, (v) => Math.round(v).toString());
  const pathLength = useTransform(spring, (v) => Math.max(0, Math.min(1, v / 100)));

  useEffect(() => {
    if (shown !== null) value.set(shown);
  }, [shown, value]);

  if (shown === null) return null;

  const stroke = shown >= 80 ? "var(--color-success)" : shown >= 60 ? "var(--color-primary)" : "var(--color-error)";
  const r = (size - 6) / 2;

  const label = [
    lift !== null ? `ATS match ${before}% before tailoring, ${shown}% now` : `ATS match ${shown}%`,
    projected !== null && score !== null && projected !== score
      ? `${score}% scored, ${projected}% projected`
      : null,
    stale ? "score may not reflect your latest choices" : null,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <div className="flex items-center gap-sm" aria-label={label}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={3}
            className="stroke-outline-variant/40"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            stroke={stroke}
            style={{ pathLength }}
          />
        </svg>
        <motion.span
          className="tabular absolute inset-0 flex items-center justify-center text-label-md font-bold text-on-surface"
        >
          {display}
        </motion.span>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-label-caps text-on-surface-variant">ATS</span>
        {delta !== 0 && (
          <motion.span
            data-testid={lift !== null ? "score-lift" : "score-delta"}
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className={`tabular text-caption font-bold ${
              delta > 0 ? "text-success" : "text-error"
            }`}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
            {/* The "after" is the big number; naming the "before" beside it is
                what makes the gain a before → after claim rather than a chip. */}
            {lift !== null && (
              <span className="tabular text-caption font-normal text-on-surface-variant">
                {" "}
                from {before}
              </span>
            )}
          </motion.span>
        )}
        {stale && (
          <span
            data-testid="score-stale"
            title="Couldn't recalculate just now — this figure may not reflect your latest choices."
            className="text-caption text-tertiary"
          >
            may be stale
          </span>
        )}
      </div>
    </div>
  );
}
