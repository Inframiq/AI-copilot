"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { RocketLaunch, ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useTourStore } from "@/stores/tour-store";
import { TOUR_STEPS } from "./tour-steps";

const MOBILE_BREAKPOINT = 768; // matches Tailwind's `md` — Sidebar is `hidden md:flex`

type Rect = { top: number; left: number; width: number; height: number };

function measure(href: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${href}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // hidden (e.g. mobile sidebar)
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function GuidedTour() {
  const { active, stepIndex, next, prev, skip } = useTourStore();
  const pathname = usePathname();
  const [rect, setRect] = useState<Rect | null>(null);

  const step = TOUR_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // Bail out quietly on mobile — the sidebar this tour spotlights doesn't
  // render there, so there's nothing to point at.
  useEffect(() => {
    if (active && typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT) {
      skip();
    }
  }, [active, skip]);

  // Leaving /dashboard mid-tour (user clicked through, or navigated away)
  // ends the tour instead of fighting the navigation or floating a stale
  // spotlight over the wrong page.
  useEffect(() => {
    if (active && pathname !== "/dashboard") skip();
  }, [active, pathname, skip]);

  useEffect(() => {
    if (!active) return;
    function recompute() {
      setRect(measure(step.href));
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [active, step.href]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") skip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, skip]);

  if (!active || !rect) return null;

  // Bubble sits just right of the sidebar (280px wide), vertically aligned
  // to the spotlighted item and clamped so it never runs off the bottom.
  const bubbleTop = Math.min(Math.max(rect.top - 12, 16), window.innerHeight - 260);

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Spotlight cutout: a transparent box over the target with a huge
          box-shadow standing in for the dimmed backdrop everywhere else. */}
      <div
        className="fixed rounded-xl transition-all duration-300 pointer-events-none"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          boxShadow: "0 0 0 9999px rgba(23, 24, 29, 0.65)",
        }}
      />

      <div
        className="fixed w-[320px] bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-2xl p-lg animate-tour-pop-in"
        style={{ top: bubbleTop, left: 296 }}
      >
        <div className="flex items-start gap-md">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 animate-tour-float">
            <RocketLaunch size={20} weight="fill" className="text-on-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-label-md text-on-surface font-bold">{step.title}</p>
            <p className="text-body-sm text-on-surface-variant mt-xs">{step.body}</p>
          </div>
        </div>

        <div className="flex items-center gap-xs mt-lg mb-md">
          {TOUR_STEPS.map((s, i) => (
            <span
              key={s.href}
              className={`h-[6px] rounded-full transition-all ${
                i === stepIndex ? "w-6 bg-primary" : "w-[6px] bg-outline-variant"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-sm">
          <button
            onClick={skip}
            className="text-label-sm text-on-surface-variant hover:text-on-surface hover:underline"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-xs">
            {!isFirst && (
              <button
                onClick={prev}
                aria-label="Back"
                className="p-sm rounded-lg text-on-surface-variant hover:bg-surface-container-high/50 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-xs px-md py-sm rounded-lg text-label-sm font-semibold bg-primary text-on-primary hover:bg-primary-container transition-colors"
            >
              {isLast ? "Got it!" : "Next"}
              {!isLast && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
