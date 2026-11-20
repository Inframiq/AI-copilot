"use client";
import { useLayoutEffect, useRef } from "react";
import { textareaCls } from "./ProfileFormParts";

const BULLET = "• ";
const MARKED = /^\s*(?:[-*•–·]|\d+[.)])\s/;

/** Every line that has text, starting with a bullet. */
function marked(text: string): string {
  return text.split("\n").map((l) => (l.trim() && !MARKED.test(l) ? BULLET + l.trimStart() : l)).join("\n");
}

/**
 * A Profile box of résumé points, shown as the résumé prints them: one
 * point per line, each after a bullet. Enter starts the next point; the box
 * grows with its text instead of scrolling. The text is stored as shown
 * (resumePoints reads the points back out).
 */
export function PointsTextarea({ id, value, onChange, placeholder, label }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** For a box whose <label> isn't tied to it by id. */
  label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  // As tall as the text, at whatever width the box has now.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    if (caret.current !== null) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
    if (typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth !== width) { width = el.clientWidth; fit(); }
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={label}
      value={value}
      rows={2}
      placeholder={placeholder}
      className={`${textareaCls} overflow-hidden leading-relaxed`}
      onChange={(e) => {
        const text = e.target.value;
        // The first thing typed or pasted into an empty box becomes points.
        onChange(value.trim() ? text : marked(text));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        const el = e.currentTarget;
        const at = el.selectionStart;
        const insert = `\n${BULLET}`;
        caret.current = at + insert.length;
        onChange(value.slice(0, at) + insert + value.slice(el.selectionEnd));
      }}
    />
  );
}
