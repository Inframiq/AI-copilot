"use client";
import { Check } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { Step, StepId } from "@/lib/studio-steps";

const DOT: Record<Step["status"], string> = {
  done: "bg-primary text-on-primary border-primary",
  current: "bg-surface text-primary border-primary",
  available: "bg-surface text-on-surface-variant border-outline-variant",
  locked: "bg-surface text-outline border-outline-variant/40 opacity-40",
};

export function StepNode({
  step,
  index,
  isActive,
  onSelect,
}: {
  step: Step;
  index: number;
  isActive: boolean;
  onSelect: (id: StepId) => void;
}) {
  const locked = step.status === "locked";
  return (
    <button
      type="button"
      disabled={locked}
      aria-current={isActive ? "step" : undefined}
      // The locked reason rides in the accessible name so the UI teaches
      // the flow instead of presenting a dead control with no explanation.
      aria-label={locked ? `${step.label} — ${step.lockedReason}` : step.label}
      title={locked ? step.lockedReason : undefined}
      onClick={() => !locked && onSelect(step.id)}
      className={`group flex items-center gap-sm shrink-0 ${
        locked ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <span
        className={`relative flex items-center justify-center w-7 h-7 rounded-full border-2 text-caption font-bold transition-colors ${DOT[step.status]}`}
      >
        {step.status === "done" ? <Check size={14} weight="bold" /> : index + 1}
        {step.status === "current" && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-primary"
            animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </span>
      <span
        className={`text-label-caps whitespace-nowrap transition-colors ${
          isActive
            ? "text-on-surface font-bold"
            : locked
            ? "text-outline"
            : "text-on-surface-variant group-hover:text-on-surface"
        }`}
      >
        {step.label}
      </span>
    </button>
  );
}
