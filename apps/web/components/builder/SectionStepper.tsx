"use client";
import { useEffect, useRef } from "react";
import { Check } from "@phosphor-icons/react";
import { sectionStates, type SectionId } from "@/lib/section-completeness";
import type { ResumeContent } from "@career-copilot/types";
import { FOCUS_RING } from "@/lib/focus";

/**
 * Contact → Summary → … → Extras.
 *
 * Every step is reachable in both directions and nothing is ever disabled:
 * the spec is explicit that this must not behave like a locked wizard. The
 * three states come from section-completeness, which already tracks how
 * filled each section is — this is a view of that, not a second source.
 *
 * Phones keep the whole row, compressed: every step shows its number or
 * tick, only the current one its name, so all six fit one line at 360px
 * instead of three and a half with the rest scrolled out of sight.
 */
export function SectionStepper({
  content,
  current,
  onSelect,
}: {
  content: ResumeContent | null;
  current: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  const states = sectionStates(content);
  const navRef = useRef<HTMLElement>(null);

  // Keep the current step in view when Continue/Previous moves it — on a
  // narrow screen the row may still scroll.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="step"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current]);

  return (
    <nav
      ref={navRef}
      aria-label="Resume sections"
      className="flex shrink-0 items-center gap-1 sm:gap-xs overflow-x-auto border-b border-outline-variant/20 px-sm sm:px-lg py-sm [scrollbar-width:none]"
    >
      {states.map((state, i) => {
        const status =
          state.id === current ? "current" : state.complete ? "complete" : "upcoming";
        return (
          <div key={state.id} className="flex shrink-0 items-center gap-1 sm:gap-xs">
            {i > 0 && <span aria-hidden className="h-px w-3 bg-outline-variant/40 sm:w-10" />}
            <button
              type="button"
              data-testid={`step-${state.id}`}
              data-state={status}
              aria-current={status === "current" ? "step" : undefined}
              aria-label={state.label}
              title={state.label}
              onClick={() => onSelect(state.id)}
              className={`flex items-center gap-xs rounded-full px-sm py-xs text-label-md whitespace-nowrap transition-colors ${FOCUS_RING} ${
                status === "current"
                  ? "font-semibold text-primary"
                  : status === "complete"
                    ? "text-on-surface-variant hover:text-on-surface"
                    : "text-on-surface-variant/60 hover:text-on-surface-variant"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-caption ${
                  status === "complete"
                    ? "border-success bg-success text-on-success"
                    : status === "current"
                      ? "border-primary text-primary"
                      : "border-outline-variant/60"
                }`}
              >
                {status === "complete" ? <Check size={12} weight="bold" /> : i + 1}
              </span>
              <span aria-hidden className={status === "current" ? "" : "hidden sm:inline"}>
                {state.label}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
