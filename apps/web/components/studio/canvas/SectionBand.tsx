"use client";
import type React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDown } from "@phosphor-icons/react";
import type { SectionState } from "@/lib/section-completeness";
import { CompletenessRing } from "@/components/studio/rail/CompletenessRing";

// One link in the chain. Collapsed it is a quiet full-width bar; expanded
// it unfolds in place at full width with generous padding, while its
// neighbours stay visible as slim links so the chain is never lost.
export function SectionBand({
  state,
  digest,
  open,
  children,
  onToggle,
}: {
  state: SectionState;
  digest: string;
  open: boolean;
  children: React.ReactNode;
  onToggle: () => void;
}) {
  return (
    <motion.section
      layout
      transition={{ type: "spring", stiffness: 260, damping: 32 }}
      className={`overflow-hidden rounded-2xl border transition-colors ${
        open
          ? "border-primary/30 bg-surface-container-lowest shadow-lg"
          : "border-outline-variant/30 bg-surface-container-lowest hover:border-primary/30"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex items-center gap-md px-lg py-md text-left"
      >
        <CompletenessRing ratio={state.ratio} size={18} />
        <span className="flex-1 min-w-0 flex items-baseline gap-md">
          <span
            className={`text-label-caps shrink-0 ${
              open ? "text-on-surface" : "text-on-surface-variant"
            }`}
          >
            {state.label}
          </span>
          {!open && (
            <span className="text-body-sm text-on-surface-variant truncate">{digest}</span>
          )}
        </span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="shrink-0 text-on-surface-variant"
        >
          <CaretDown size={16} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 32 }}
          >
            {/* Generous, not compact — an open band is the spacious state. */}
            <div className="px-xl pb-xl pt-sm flex flex-col gap-lg">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
