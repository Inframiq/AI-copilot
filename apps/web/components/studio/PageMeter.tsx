"use client";
import { Files, Warning } from "@phosphor-icons/react";

/**
 * How long the résumé is, in the unit that matters: pages of the PDF.
 *
 * Two pages is a judgement call rather than a failure — plenty of résumés
 * should be two — so this reports rather than warns. What it must do is name
 * the remedy: the points that caused the overflow are chosen on the previous
 * screen, so there is nothing to act on here.
 */
export function PageMeter({ pages, className = "" }: { pages: number; className?: string }) {
  const overflows = pages > 1;
  return (
    <div className={`flex flex-wrap items-center gap-sm ${className}`}>
      <span
        data-testid="page-count"
        className={`flex shrink-0 items-center gap-xs rounded-full px-sm py-0.5 text-caption font-medium ${
          overflows
            ? "bg-tertiary-container/60 text-on-tertiary-container"
            : "bg-surface-container text-on-surface-variant"
        }`}
      >
        {overflows ? <Warning size={12} weight="fill" /> : <Files size={12} />}
        {pages} {pages === 1 ? "page" : "pages"}
      </span>
      {overflows && (
        <span role="status" className="text-caption text-on-surface-variant">
          The dashed line is where page&nbsp;2 starts. To shorten it, go back and turn points off.
        </span>
      )}
    </div>
  );
}
