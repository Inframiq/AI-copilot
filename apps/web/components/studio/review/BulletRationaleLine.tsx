"use client";
import type { BulletRationale } from "@/lib/api-client";

// Agent 2 produces a responsibility and a keyword list for every bullet it
// transforms. Both are billed on every run and were previously discarded.
// Without them the review is "trust me"; with them the reader can judge
// whether the rewrite actually earns the claim.
//
// Ported from the removed components/resume/BulletReviewPanel.tsx, which the
// studio redesign replaced while this landed upstream.
export function BulletRationaleLine({
  rationale,
  testId,
}: {
  rationale?: BulletRationale;
  testId: string;
}) {
  if (!rationale) return null;
  const { responsibility, keywords } = rationale;
  if (!responsibility && keywords.length === 0) return null;
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-xs border-t border-outline-variant/20 pt-md"
    >
      {responsibility && (
        <p className="text-body-md leading-relaxed text-on-surface-variant">
          <span className="text-label-caps text-on-surface">Now shows </span>
          {responsibility}
        </p>
      )}
      {keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-xs">
          <span className="text-label-caps text-on-surface-variant">Keywords woven in</span>
          {keywords.map((k) => (
            <span
              key={k}
              className="rounded-full bg-primary/10 px-sm py-0.5 text-caption font-medium text-primary"
            >
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
