"use client";
import { useState } from "react";
import { repeatedAt, withoutRepeats } from "@/lib/duplicates";

const textareaCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

const toLines = (text: string) => text.split("\n").filter((line) => line.trim());

/**
 * A list edited as one line per item. The text is kept as typed — rebuilding
 * it from the saved lines on every keystroke dropped the empty line Enter
 * had just made, so a second item could never be started at the end. The
 * store gets the non-empty lines; a change from outside (an undo, a tailor)
 * replaces the draft.
 */
export function LinesTextarea({ id, lines, onChange, placeholder, className }: {
  id: string;
  lines: string[];
  onChange: (lines: string[]) => void;
  placeholder: string;
  /** Classes for the box, when it sits somewhere other than Extras. */
  className?: string;
}) {
  const [draft, setDraft] = useState(lines.join("\n"));
  const joined = lines.join("\n");
  if (toLines(draft).join("\n") !== joined) setDraft(joined);
  // A line given twice: said here, and dropped on leaving the box — not
  // while typing, when a line can match another on its way to something
  // longer.
  const repeats = [...repeatedAt(lines)].map((i) => lines[i]);
  return (
    <>
      <textarea
        id={id}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(toLines(e.target.value));
        }}
        onBlur={() => {
          if (repeats.length) onChange(withoutRepeats(lines));
        }}
        aria-invalid={repeats.length > 0 || undefined}
        aria-describedby={repeats.length ? `${id}-repeats` : undefined}
        rows={3}
        placeholder={placeholder}
        className={className ?? textareaCls}
      />
      {repeats.length > 0 && (
        <p id={`${id}-repeats`} className="text-caption text-error">
          Listed twice: {repeats.join(", ")}. The repeat goes when you leave the box.
        </p>
      )}
    </>
  );
}
