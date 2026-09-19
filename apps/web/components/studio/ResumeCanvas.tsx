"use client";
import { useEffect, useRef } from "react";
import { sanitizeInline } from "@/lib/rich-text";
import { pageGeometry, pageCount } from "@/lib/page-geometry";
import { scopeBodyToHost } from "@/lib/shadow-document";

/**
 * Editing affordance, injected into the shadow root rather than written into
 * the templates: it is a property of *editing* the document, not of the
 * document, so it must never reach the PDF.
 *
 * Only background and box-shadow change — a border or padding would reflow
 * the page and make the résumé shift under the cursor.
 */
const PAGE_BREAK_CSS = `
[data-page-break] {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed rgba(154, 90, 30, 0.55);
  pointer-events: none;
  font: 600 9pt -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #9a5a1e;
}
[data-page-break] > span {
  /* In the left margin gutter, centred on the rule. Anywhere inside the text
     column it would sit on top of the résumé's own words. */
  position: absolute;
  left: 0;
  transform: translateY(-50%);
  min-width: 18px;
  text-align: center;
  background: #f6e3cf;
  border-radius: 999px;
  padding: 1px 6px;
}
`;

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
[data-link] {
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 120ms ease, box-shadow 120ms ease;
}
[data-link]:hover,
[data-link]:focus-visible {
  outline: none;
  background-color: rgba(59, 91, 219, 0.11);
  box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.11);
}
[data-studio-add-links] {
  position: relative;
  display: inline-block;
  width: 0;
  height: 1em;
  vertical-align: baseline;
}
[data-studio-add-links] > span {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 4px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
:hover > [data-studio-add-links] > span,
[data-studio-add-links]:focus-within > span {
  opacity: 1;
  pointer-events: auto;
}
[data-studio-add-links] button {
  font: 600 10.5px/1.4 system-ui, sans-serif;
  color: rgb(59, 91, 219);
  background: #fff;
  border: 1px dashed rgba(59, 91, 219, 0.55);
  border-radius: 999px;
  padding: 1px 8px;
  cursor: pointer;
}
[data-studio-add-links] button:hover,
[data-studio-add-links] button:focus-visible {
  outline: none;
  background: rgba(59, 91, 219, 0.1);
  border-style: solid;
}
@media (prefers-reduced-motion: reduce) {
  [data-field], [data-link], [data-studio-add-links] > span { transition: none; }
}
`;

/** The links a project can carry, in the order the templates show them. A
 *  missing one has nothing in the document to click, so the canvas offers
 *  to add it beside the project's name. */
const PROJECT_LINKS = [
  { key: "link", label: "Link" },
  { key: "live_link", label: "Live link" },
] as const;

/** A link in the document the user asked to edit: its URL and display text
 *  live at `path` and `${path}_label` in the résumé. */
export interface LinkTarget {
  path: string;
  url: string;
  /** The display text as stored — empty when the link shows its URL. */
  text: string;
  /** Where the link is on screen, to anchor the editor to it. */
  rect: { top: number; bottom: number; left: number };
}

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
  pageCount: pages,
  onPageCount,
  onEditLink,
}: {
  html: string;
  editable: boolean;
  onEdit: (path: string, value: string | string[]) => void;
  /** A link was chosen for editing. Links are not typed into in place: the
   *  text shown and the address it opens are two values, so they get an
   *  editor of their own. */
  onEditLink?: (link: LinkTarget) => void;
  /** Pages to mark boundaries for. Measured here when not supplied. */
  pageCount?: number;
  /** How many pages the document currently takes, reported as it changes. */
  onPageCount?: (pages: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!rootRef.current) {
      rootRef.current = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    }
    // Retargeted at :host first — a shadow root has no <body>, so the
    // template's body rule would select nothing and its font, size,
    // line-height and colour would all be missing from the preview.
    rootRef.current.innerHTML = scopeBodyToHost(html);

    // On the host, not inside the shadow root: injecting a full document as
    // innerHTML makes the parser drop <html>/<head>/<body>, so a `body` rule
    // would have nothing to match. The width matters as much as the padding —
    // laid out any wider or narrower, the document's line breaks stop being
    // the ones the PDF will have.
    const geometry = pageGeometry(html);
    host.style.width = `${geometry.width}px`;
    host.style.maxWidth = "100%";
    host.style.padding = `${geometry.margin}px`;
    host.style.boxSizing = "border-box";
    host.style.position = "relative";
  }, [html]);

  // Measure after layout, and again whenever the document reflows — a wider
  // window rewraps the text and can drop a page.
  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root || !onPageCount) return;
    const { contentHeight } = pageGeometry(html);
    const measure = () => {
      // The boundary markers are children too, and they are positioned from
      // the count this measurement produces — so including them makes the
      // measurement depend on its own last output. It does not stick (a
      // marker sits exactly on a page boundary, so it reads as one page
      // fewer), but a document trimmed from three pages to one would report
      // two before settling. Measure the document, not the annotations.
      const flowed = Array.from(root.children)
        .filter((n) => n.tagName !== "STYLE" && !n.hasAttribute("data-page-break"))
        .reduce((bottom, n) => Math.max(bottom, n.getBoundingClientRect().bottom), 0);
      const top = host.getBoundingClientRect().top + pageGeometry(html).margin;
      onPageCount(pageCount(Math.max(0, flowed - top), contentHeight));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [html, onPageCount]);

  // Boundary markers, overlaid rather than inserted: put in the flow they
  // would shift the very content whose position they report.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const stale of Array.from(root.querySelectorAll("[data-page-break]"))) stale.remove();
    if (!pages || pages < 2) return;

    const { margin, contentHeight } = pageGeometry(html);
    const style = document.createElement("style");
    style.setAttribute("data-page-break-style", "");
    style.textContent = PAGE_BREAK_CSS;
    root.appendChild(style);

    for (let page = 2; page <= pages; page += 1) {
      const mark = document.createElement("div");
      mark.setAttribute("data-page-break", String(page));
      mark.setAttribute("aria-hidden", "true");
      mark.style.top = `${margin + contentHeight * (page - 1)}px`;
      const label = document.createElement("span");
      // The number alone: the gutter is only as wide as the page margin, and
      // the meter above the sheet is what explains what the rule means.
      label.textContent = String(page);
      label.title = `Page ${page} starts here`;
      mark.appendChild(label);
      root.appendChild(mark);
    }
    return () => {
      style.remove();
      for (const mark of Array.from(root.querySelectorAll("[data-page-break]"))) mark.remove();
    };
  }, [html, pages]);

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

    for (const link of Array.from(root.querySelectorAll<HTMLElement>("[data-link]"))) {
      if (!editable || !onEditLink) {
        link.removeAttribute("tabindex");
        link.removeAttribute("role");
        continue;
      }
      link.setAttribute("tabindex", "0");
      link.setAttribute("role", "button");
      link.setAttribute("aria-label", `Edit link: ${link.textContent ?? ""}`);
      const open = (event: Event) => {
        // An <a> in the canvas would otherwise navigate the whole app away.
        event.preventDefault();
        event.stopPropagation();
        const r = link.getBoundingClientRect();
        onEditLink({
          path: link.dataset.link ?? "",
          url: link.dataset.linkUrl ?? "",
          text: link.dataset.linkText ?? "",
          rect: { top: r.top, bottom: r.bottom, left: r.left },
        });
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      };
      link.addEventListener("click", open);
      link.addEventListener("keydown", onKey);
      cleanups.push(() => {
        link.removeEventListener("click", open);
        link.removeEventListener("keydown", onKey);
      });
    }

    // Floated over the page, never in its flow, so offering a link moves no
    // line and costs no page. The export renders on the server and never
    // sees these.
    if (editable && onEditLink) {
      for (const name of Array.from(root.querySelectorAll<HTMLElement>("[data-field$='.name']"))) {
        const index = /^projects\.(\d+)\.name$/.exec(name.dataset.field ?? "")?.[1];
        if (index === undefined) continue;
        const missing = PROJECT_LINKS.filter(
          ({ key }) => !root.querySelector(`[data-link="projects.${index}.${key}"]`),
        );
        if (missing.length === 0) continue;

        const anchor = document.createElement("span");
        anchor.setAttribute("data-studio-add-links", "");
        const bar = document.createElement("span");
        anchor.appendChild(bar);
        for (const { key, label } of missing) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = `+ ${label}`;
          button.setAttribute("aria-label", `Add ${label.toLowerCase()} to ${name.textContent ?? "project"}`);
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const r = button.getBoundingClientRect();
            onEditLink({
              path: `projects.${index}.${key}`,
              url: "",
              text: "",
              rect: { top: r.top, bottom: r.bottom, left: r.left },
            });
          });
          bar.appendChild(button);
        }
        name.after(anchor);
        cleanups.push(() => anchor.remove());
      }
    }

    for (const node of nodes) {
      // A field that holds a link is edited through the link editor: typed
      // into in place, the caret would land inside the <a> and change the
      // text while leaving the address behind.
      if (node.querySelector("[data-link]")) {
        node.setAttribute("contenteditable", "false");
        continue;
      }
      // setAttribute, not the contentEditable property: the property is a
      // no-op under jsdom, and the attribute is what browsers read anyway.
      // A rich field must be fully editable: plaintext-only would make
      // execCommand("bold") a silent no-op, so these trade the paste
      // protection for the formatting the toolbar offers, and lean on
      // sanitizeInline instead.
      const rich = node.hasAttribute("data-field-rich");
      node.setAttribute(
        "contenteditable",
        editable ? (rich ? "true" : editableValue()) : "false",
      );
      if (!editable) continue;

      const read = () =>
        rich ? sanitizeInline(node.innerHTML) : node.textContent ?? "";

      // Mutable, so a commit is idempotent: Enter commits and then blurs, and
      // the blur that follows must not report the same edit a second time.
      let committed = read();
      const commit = () => {
        const next = read();
        if (next === committed) return;
        committed = next;
        const path = node.dataset.field;
        if (!path) return;
        // A joined list (skills, rendered as one comma-separated line) is one
        // field on screen but an array in the résumé, so it splits back on the
        // separator the template used. Blanks from a trailing or doubled
        // separator are dropped rather than stored as empty skills.
        const separator = node.dataset.fieldSplit;
        onEdit(
          path,
          separator
            ? next.split(separator.trim() || separator).map((s) => s.trim()).filter(Boolean)
            : next,
        );
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
  }, [html, editable, onEdit, onEditLink]);

  return (
    <div
      data-canvas
      ref={hostRef}
      className="mx-auto w-full max-w-[8.5in] bg-white shadow-xl"
    />
  );
}
