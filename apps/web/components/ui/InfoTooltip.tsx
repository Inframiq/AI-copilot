"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Info } from "@phosphor-icons/react";

interface InfoTooltipProps {
  /** What the card/section does — kept short, this is a tooltip not a page. */
  text: string;
  className?: string;
}

/** A small "i" affordance that reveals `text` in a floating card on hover,
 * keyboard focus, or tap — so it works for mouse, keyboard, and touch users
 * alike. The bubble always uses inverse-surface/inverse-on-surface (a fixed
 * dark background with near-white text), which keeps contrast solidly
 * WCAG-AA regardless of what it's floating over. */
export function InfoTooltip({ text, className }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className={`relative inline-flex ${className ?? ""}`}>
      <button
        type="button"
        aria-label="More info"
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Not a toggle: a real click event fires after mouseenter/focus
          // have already opened it (hover-capable devices), so a toggle
          // here would immediately close what hover just opened. Touch
          // devices (no hover) get the same "tap opens" result either way;
          // closing is handled by the outside-click/Escape listeners below.
          e.stopPropagation();
          setOpen(true);
        }}
        className="w-4 h-4 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary focus:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors shrink-0"
      >
        <Info size={16} weight="bold" />
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-xs w-max max-w-[220px] rounded-lg bg-inverse-surface text-inverse-on-surface text-caption leading-snug px-sm py-xs shadow-lg text-left"
        >
          {text}
        </span>
      )}
    </span>
  );
}
