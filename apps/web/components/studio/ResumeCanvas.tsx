"use client";
import { useEffect, useRef } from "react";

/**
 * The résumé document, rendered from the server's own template output.
 *
 * Mounted in a shadow root deliberately: the document carries its own
 * <style> block including @page rules, which would otherwise leak out and
 * restyle the surrounding app.
 *
 * The HTML is our template output with every user-supplied value already
 * escaped server-side (see pdf.py's _highlight_keywords / _email_link /
 * _url_link), so this is not an injection sink — but it must only ever be
 * given markup the server rendered, never anything a caller supplied.
 *
 * Edits are reported on blur rather than per keystroke: the page re-renders
 * the document when content changes, and doing that mid-keystroke would
 * yank the caret out from under the user.
 */
export function ResumeCanvas({
  html,
  editable,
  onEdit,
}: {
  html: string;
  editable: boolean;
  onEdit: (path: string, value: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!rootRef.current) {
      rootRef.current = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    }
    rootRef.current.innerHTML = html;
  }, [html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-field]"));
    const cleanups: Array<() => void> = [];

    for (const node of nodes) {
      // setAttribute, not the contentEditable property: the property is a
      // no-op under jsdom, and the attribute is what browsers read anyway.
      node.setAttribute("contenteditable", editable ? "true" : "false");
      if (!editable) continue;

      // Captured per node at bind time, so an unchanged blur stays silent and
      // does not churn the résumé through a needless re-render.
      const original = node.textContent ?? "";
      const handleBlur = () => {
        const next = node.textContent ?? "";
        if (next === original) return;
        const path = node.dataset.field;
        if (path) onEdit(path, next);
      };
      node.addEventListener("blur", handleBlur);
      cleanups.push(() => node.removeEventListener("blur", handleBlur));
    }
    return () => cleanups.forEach((fn) => fn());
  }, [html, editable, onEdit]);

  return (
    <div
      data-canvas
      ref={hostRef}
      className="mx-auto w-full max-w-[8.5in] bg-white shadow-xl"
    />
  );
}
