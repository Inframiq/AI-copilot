"use client";
import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

// The ATS score is the single most motivating number in the product; the
// old UI rendered it at 11px in three different places. Here it gets one
// home, at size, with the ring and the number animating to any projected
// value so a decision in the triage deck reads as visible progress.
export function AtsRing({
  score,
  projected,
  size = 52,
}: {
  score: number | null;
  projected: number | null;
  size?: number;
}) {
  const shown = projected ?? score;
  const delta = score !== null && projected !== null ? projected - score : 0;

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

  return (
    <div
      className="flex items-center gap-sm"
      aria-label={
        projected !== null && score !== null && projected !== score
          ? `ATS match ${score}%, projected ${projected}%`
          : `ATS match ${shown}%`
      }
    >
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
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className={`tabular text-caption font-bold ${
              delta > 0 ? "text-success" : "text-error"
            }`}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
          </motion.span>
        )}
      </div>
    </div>
  );
}
