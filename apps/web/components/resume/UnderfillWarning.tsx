"use client";
import { Warning } from "@phosphor-icons/react";

/**
 * Advisory shown when a rendered resume fits on a single page but leaves a
 * visible empty band at the bottom — i.e. it's shorter than a full page. The
 * backend decides this (pdf.py `_page_meta` / `UNDERFILL_PAGE_FILL_THRESHOLD`)
 * and returns `underfilled: true` from the PDF render + generate endpoints;
 * this component is purely the presentation of that flag.
 *
 * Advisory only — nothing is blocked. Rendered in the Studio preview pane and
 * in the tailoring review panel. Uses the `tertiary` (warm bronze) role, the
 * same caution accent the rest of Studio uses.
 */
export function UnderfillWarning({ show, className = "" }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <div
      role="status"
      className={`rounded-xl border border-tertiary/40 bg-tertiary/10 px-md py-sm flex items-start gap-sm ${className}`}
    >
      <Warning size={18} weight="fill" className="text-tertiary shrink-0 mt-0.5" />
      <p className="text-label-md text-on-surface">
        Too few points — this resume is shorter than a full page. Add more
        bullet points or sections so it fills the page.
      </p>
    </div>
  );
}
