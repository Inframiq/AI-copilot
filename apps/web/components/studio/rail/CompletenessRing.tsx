"use client";
import { motion } from "motion/react";

export function CompletenessRing({ ratio, size = 16 }: { ratio: number; size?: number }) {
  const r = (size - 3) / 2;
  const full = ratio >= 1;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={2}
        className="stroke-outline-variant/50"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        className={full ? "stroke-success" : "stroke-primary"}
        initial={false}
        animate={{ pathLength: Math.max(0, Math.min(1, ratio)) }}
        transition={{ type: "spring", stiffness: 160, damping: 26 }}
      />
    </svg>
  );
}
