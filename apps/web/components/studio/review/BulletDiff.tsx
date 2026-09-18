"use client";
import { useMemo } from "react";
import { diffWords } from "@/lib/word-diff";

// One side of a word-level diff. The review screen exists to answer "how well
// was my bullet rephrased?" — a whole-line strikethrough above the rewrite
// makes the reader diff two sentences by eye on every bullet; highlighting
// only the words that moved answers it at a glance.
//
// Ported from the removed components/resume/BulletReviewPanel.tsx, which the
// studio redesign replaced while this landed upstream.
export function BulletDiff({
  original,
  tailored,
  side,
  testId,
}: {
  original: string;
  tailored: string;
  side: "added" | "removed";
  testId: string;
}) {
  const ops = useMemo(() => diffWords(original, tailored), [original, tailored]);
  const drop = side === "added" ? "delete" : "insert";
  const mark = side === "added" ? "insert" : "delete";
  return (
    <>
      {ops
        .filter((op) => op.type !== drop)
        .map((op, i) =>
          op.type === mark ? (
            <mark
              key={i}
              data-testid={testId}
              className={
                side === "added"
                  ? "bg-primary/10 text-on-surface rounded-sm px-0.5 box-decoration-clone"
                  : "bg-error/10 text-on-surface-variant line-through rounded-sm px-0.5"
              }
            >
              {op.text}
            </mark>
          ) : (
            // Each side renders with its OWN spacing — see DiffOp.tailoredText.
            <span key={i}>{side === "added" ? op.tailoredText ?? op.text : op.text}</span>
          ),
        )}
    </>
  );
}
