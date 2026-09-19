"use client";
import { useEffect, useId, useRef, useState } from "react";
import { FOCUS_RING } from "@/lib/focus";
import type { LinkTarget } from "./ResumeCanvas";

const WIDTH = 320;
const GUTTER = 16;

/**
 * Edits a link's two halves: the text the résumé shows and the address it
 * opens. Blank display text shows the URL itself, which is what every link
 * did before display text existed.
 *
 * Anchored under the link, in the page rather than the canvas's shadow root,
 * so it is styled by the app and never part of the document that exports.
 * Scrolling closes it rather than leaving it floating over the wrong line.
 */
export function LinkEditor({
  link,
  onSave,
  onRemove,
  onClose,
}: {
  link: LinkTarget;
  onSave: (url: string, text: string) => void;
  /** Takes the link off the résumé. Offered only for a link that exists. */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const adding = !link.url;
  const [text, setText] = useState(link.text);
  const [url, setUrl] = useState(link.url);
  const panelRef = useRef<HTMLFormElement>(null);
  const textId = useId();
  const urlId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const viewport = typeof window === "undefined" ? 1024 : window.innerWidth;
  const left = Math.max(GUTTER, Math.min(link.rect.left, viewport - WIDTH - GUTTER));
  const trimmedUrl = url.trim();

  return (
    <form
      ref={panelRef}
      role="dialog"
      aria-label={adding ? "Add link" : "Edit link"}
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmedUrl) return;
        onSave(trimmedUrl, text.trim());
      }}
      style={{ top: link.rect.bottom + 8, left, width: `min(${WIDTH}px, calc(100vw - ${GUTTER * 2}px))` }}
      className="fixed z-50 flex flex-col gap-sm rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-md shadow-xl"
    >
      <label htmlFor={textId} className="text-label-sm font-semibold text-on-surface">
        Display text
      </label>
      <input
        id={textId}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={trimmedUrl || "Shown on the résumé"}
        className={`rounded-lg border border-outline-variant/50 bg-surface px-sm py-xs text-body-sm text-on-surface ${FOCUS_RING}`}
      />
      <label htmlFor={urlId} className="text-label-sm font-semibold text-on-surface">
        Link URL
      </label>
      <input
        id={urlId}
        type="text"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://"
        className={`rounded-lg border border-outline-variant/50 bg-surface px-sm py-xs text-body-sm text-on-surface ${FOCUS_RING}`}
      />
      <p className="text-caption text-on-surface-variant">
        Leave the display text blank to show the URL itself.
      </p>
      <div className="flex justify-end gap-sm">
        {!adding && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className={`mr-auto rounded-xl px-md py-xs text-label-md text-error hover:bg-error-container/30 ${FOCUS_RING}`}
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`rounded-xl px-md py-xs text-label-md text-on-surface-variant hover:bg-surface-container ${FOCUS_RING}`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!trimmedUrl}
          className={`rounded-xl bg-primary px-md py-xs text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          {adding ? "Add" : "Save"}
        </button>
      </div>
    </form>
  );
}
