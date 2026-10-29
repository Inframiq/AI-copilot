"use client";
import { forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SUGGEST_CREDIT,
  canonicalName,
  loadSuggestions,
  suggest,
  type SuggestIndex,
  type SuggestKind,
} from "@/lib/suggest";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list">;

/**
 * A text field that suggests names from one of the app's lists as you type
 * (lib/suggest). Anything not in the list can still be typed. Picking a
 * suggestion — or leaving the field with exactly a name or an alias typed,
 * "js" or "javascript" — puts in the list's own name, "JavaScript".
 *
 * `onPick` is for a field that adds what's picked somewhere else (a skill
 * chip) instead of keeping it. `list` is for a comma-separated field (a
 * project's tech stack): suggestions are for the part after the last comma.
 *
 * Arrows move through the suggestions, Enter takes the highlighted one,
 * Escape closes them. Nothing is highlighted unless what's typed is exactly
 * a name or alias, so Enter on new text still means that text.
 */
export const SuggestInput = forwardRef<HTMLInputElement, InputProps & {
  kind: SuggestKind;
  value: string;
  onValueChange: (value: string) => void;
  onPick?: (name: string) => void;
  list?: boolean;
}>(function SuggestInput({ kind, value, onValueChange, onPick, list = false, ...input }, outerRef) {
  const [index, setIndex] = useState<SuggestIndex | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const cut = list ? value.lastIndexOf(",") + 1 : 0;
  const term = value.slice(cut).trim();
  const items = useMemo(() => {
    if (!index || !term) return [];
    const found = suggest(index, term);
    // Nothing to offer when the one match is already what's there.
    return found.length === 1 && found[0] === term ? [] : found;
  }, [index, term]);
  const shown = open && items.length > 0;

  // Highlight a suggestion only when it's exactly what was typed.
  useEffect(() => {
    const exact = index && term ? canonicalName(index, term) : null;
    setActive(exact ? items.indexOf(exact) : -1);
  }, [index, term, items]);

  // Under the field, or above it when there's more room there (a phone's
  // keyboard). Rendered into <body>: the cards this sits in clip overflow.
  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 220);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      const below = window.innerHeight - r.bottom;
      setBox(below < 220 && r.top > below
        ? { left, width, bottom: window.innerHeight - r.top + 4 }
        : { left, width, top: r.bottom + 4 });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [shown]);

  function load() {
    if (!index) loadSuggestions(kind).then(setIndex).catch(() => {});
  }

  function pick(name: string) {
    setOpen(false);
    if (onPick) return onPick(name);
    onValueChange(list ? `${value.slice(0, cut).trimEnd()}${cut ? " " : ""}${name}` : name);
  }

  /** What's typed, with each exact name or alias in the list's spelling. */
  function tidy(text: string): string {
    if (!index) return text;
    const part = (t: string) => canonicalName(index, t) ?? t.trim();
    return list ? text.split(",").map(part).filter(Boolean).join(", ") : part(text);
  }

  return (
    <>
      <input
        {...input}
        ref={(el) => {
          inputRef.current = el;
          if (typeof outerRef === "function") outerRef(el);
          else if (outerRef) outerRef.current = el;
        }}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onFocus={(e) => {
          load();
          // On a phone, bring the field to the middle of the screen once the
          // keyboard is up, leaving room for suggestions under it — near
          // the bottom it sat behind the tab bar with them over it. Not
          // smooth: typing straight away cancelled a smooth scroll midway.
          if (window.innerWidth < 768) {
            const el = e.currentTarget;
            setTimeout(() => el.scrollIntoView?.({ block: "center" }), 300);
          }
          input.onFocus?.(e);
        }}
        onChange={(e) => {
          load();
          setOpen(true);
          onValueChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (shown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const n = items.length;
            const down = e.key === "ArrowDown";
            setActive((i) => (i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : -1) + n) % n));
            return;
          }
          if (!shown && e.key === "ArrowDown" && items.length > 0) {
            e.preventDefault();
            setOpen(true);
            return;
          }
          if (shown && e.key === "Enter" && active >= 0) {
            e.preventDefault();
            e.stopPropagation();
            pick(items[active]);
            return;
          }
          if (shown && e.key === "Escape") {
            // Only the suggestions close, not a sheet around the field.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            return;
          }
          input.onKeyDown?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          if (!onPick) {
            const tidied = tidy(value);
            if (tidied !== value && tidied !== value.trim()) onValueChange(tidied);
          }
          input.onBlur?.(e);
        }}
      />
      {shown && box && createPortal(
        <div
          className="fixed z-[80] rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl shadow-on-surface/10 overflow-hidden"
          style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom }}
        >
          <ul id={listId} role="listbox" aria-label="Suggestions" className="max-h-64 overflow-y-auto overscroll-contain p-xs">
            {items.map((name, i) => (
              <li
                key={name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // Keep focus in the field, so the pick lands there.
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(name)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer rounded-lg px-sm py-sm text-body-sm text-on-surface ${i === active ? "bg-secondary-container" : ""}`}
              >
                <Highlight name={name} term={term} />
              </li>
            ))}
          </ul>
          {SUGGEST_CREDIT[kind] && (
            <p className="border-t border-outline-variant/20 px-sm py-xs text-[11px] text-on-surface-variant">
              {SUGGEST_CREDIT[kind]}
            </p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
});

/** The name, with what was typed in bold where it appears as typed. */
function Highlight({ name, term }: { name: string; term: string }) {
  const at = name.toLowerCase().indexOf(term.toLowerCase());
  if (!term || at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <strong className="font-semibold">{name.slice(at, at + term.length)}</strong>
      {name.slice(at + term.length)}
    </>
  );
}
