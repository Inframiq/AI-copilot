"use client";
import { useEffect, useRef } from "react";

/**
 * Editing affordance, injected into the shadow root rather than written into
 * the templates: it is a property of *editing* the document, not of the
 * document, so it must never reach the PDF.
 *
 * Only background and box-shadow change — a border or padding would reflow
 * the page and make the résumé shift under the cursor.
 */
const AFFORDANCE_CSS = `
[data-field] {
  cursor: text;
  border-radius: 3px;
  transition: background-color 120ms ease, box-shadow 120ms ease;
}
[data-field]:hover {
  background-color: rgba(59, 91, 219, 0.07);
  box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.07);
}
[data-field]:focus {
  outline: none;
  background-color: rgba(59, 91, 219, 0.11);
  box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.11), inset 0 0 0 1px rgba(59, 91, 219, 0.4);
}
@media (prefers-reduced-motion: reduce) {
  [data-field] { transition: none; }
}
`;

/**
 * `plaintext-only` keeps pasted rich text from injecting markup into the
 * document. It is invalid in browsers that lack it — and an invalid value
 * makes the element *not* editable — so it is feature-detected rather than
 * assumed. jsdom has no contentEditable property at all, which is exactly the
 * unsupported case, so tests exercise the fallback.
 */
function editableValue(): string {
  if (typeof document === "undefined") return "true";
  const probe = document.createElement("div");
  probe.setAttribute("contenteditable", "plaintext-only");
  return probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true";
}

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
 * Edits are reported on blur or Enter rather than per keystroke: the page
 * re-renders the document when content changes, and doing that mid-keystroke
 * would yank the caret out from under the user.
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

    if (editable) {
      // Appended after the effect above has replaced innerHTML, so it survives
      // every re-render of the document.
      const style = document.createElement("style");
      style.setAttribute("data-studio-affordance", "");
      style.textContent = AFFORDANCE_CSS;
      root.appendChild(style);
      cleanups.push(() => style.remove());
    }

    for (const node of nodes) {
      // setAttribute, not the contentEditable property: the property is a
      // no-op under jsdom, and the attribute is what browsers read anyway.
      node.setAttribute("contenteditable", editable ? editableValue() : "false");
      if (!editable) continue;

      // Mutable, so a commit is idempotent: Enter commits and then blurs, and
      // the blur that follows must not report the same edit a second time.
      let committed = node.textContent ?? "";
      const commit = () => {
        const next = node.textContent ?? "";
        if (next === committed) return;
        committed = next;
        const path = node.dataset.field;
        if (path) onEdit(path, next);
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        // Every annotated region is one line of a résumé — a headline, a
        // bullet, a degree. Enter must commit, not inject a line break.
        event.preventDefault();
        commit();
        node.blur();
      };

      node.addEventListener("blur", commit);
      node.addEventListener("keydown", handleKeyDown);
      cleanups.push(() => {
        node.removeEventListener("blur", commit);
        node.removeEventListener("keydown", handleKeyDown);
      });
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
