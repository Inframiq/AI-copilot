"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "@phosphor-icons/react";

interface InfoTooltipProps {
  /** What the card/section does — kept short, this is a tooltip not a page. */
  text: string;
  className?: string;
}

const BUBBLE_MAX_WIDTH = 220;
const VIEWPORT_MARGIN = 8;

/** A small "i" affordance that reveals `text` in a floating card on hover,
 * keyboard focus, or tap — so it works for mouse, keyboard, and touch users
 * alike. The bubble always uses inverse-surface/inverse-on-surface (a fixed
 * dark background with near-white text), which keeps contrast solidly
 * WCAG-AA regardless of what it's floating over.
 *
 * The bubble is portaled to document.body and positioned from the trigger's
 * real viewport coordinates, rather than a plain CSS `position: absolute`
 * nested wherever the trigger happens to live — cards across this app use
 * `overflow-hidden`, their own stacking contexts, scrollable inner lists,
 * etc., any of which would otherwise clip the bubble or bury it under a
 * sibling instead of floating above everything. */
export function InfoTooltip({ text, className }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const tooltipId = useId();
  const triggerWrapperRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    function place() {
      const trigger = triggerWrapperRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const clampedLeft = Math.min(
        Math.max(centerX, VIEWPORT_MARGIN + BUBBLE_MAX_WIDTH / 2),
        window.innerWidth - VIEWPORT_MARGIN - BUBBLE_MAX_WIDTH / 2
      );
      setPos({ top: rect.bottom + 6, left: clampedLeft });
    }
    place();

    // Position is computed once per open rather than tracked continuously —
    // simplest robust option, and a tooltip that outlives the scroll that
    // opened it is more surprising than one that just closes.
    function onScroll() {
      setOpen(false);
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = triggerWrapperRef.current?.contains(target);
      const insideBubble = bubbleRef.current?.contains(target);
      if (!insideTrigger && !insideBubble) setOpen(false);
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
    <span ref={triggerWrapperRef} className={`relative inline-flex ${className ?? ""}`}>
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
      {mounted && open && pos &&
        createPortal(
          <div
            ref={bubbleRef}
            id={tooltipId}
            role="tooltip"
            className="fixed z-[999] w-max max-w-[220px] rounded-lg bg-inverse-surface text-inverse-on-surface text-caption leading-snug px-sm py-xs shadow-lg text-left"
            style={{ top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}
