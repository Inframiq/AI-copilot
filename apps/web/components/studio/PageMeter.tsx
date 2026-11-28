"use client";
import { Files, Warning } from "@phosphor-icons/react";

/**
 * How long the résumé is, in the unit that matters: pages of the PDF.
 *
 * Two pages is a judgement call rather than a failure — plenty of résumés
 * should be two — so this reports rather than warns. What it must do is name
 * remedies that work. It used to say only "go back and turn points off", but
 * turning a reworded point off puts back the original wording, which is
 * usually the longer one: users turned everything off and got a longer
 * résumé. Spacing and Type are in this screen's header; going back helps
 * only with what tailoring added (`tailored`: a draft from the review).
 */
export function PageMeter({ pages, tailored = false, className = "" }: {
  pages: number;
  /** A tailored draft, with a review to go back to. */
  tailored?: boolean;
  className?: string;
}) {
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
          The dashed line is where page&nbsp;2 starts. To shorten it, choose Compact in Spacing or Small in Type
          {tailored
            ? ", or go back and turn off added points and the summary for this job. A reworded point turned off returns to your original wording, which is often longer."
            : ", or shorten points in Edit."}
        </span>
      )}
    </div>
  );
}
