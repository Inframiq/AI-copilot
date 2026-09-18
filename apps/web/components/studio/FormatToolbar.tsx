"use client";
import { useCallback, useEffect, useState } from "react";
import { TextB, TextItalic, TextUnderline } from "@phosphor-icons/react";
import { RICH_COMMANDS } from "@/lib/rich-text";
import { FOCUS_RING } from "@/lib/focus";

const ICON = {
  bold: TextB,
  italic: TextItalic,
  underline: TextUnderline,
} as const;

/**
 * Bold / italic / underline for the document being edited.
 *
 * Built on execCommand, which is deprecated and still the only thing that
 * applies formatting to an arbitrary selection inside contenteditable — and,
 * verified in Chromium, the only part of it we need works on a selection
 * inside a shadow root, which is where the résumé lives.
 *
 * Each button reflects queryCommandState, so a caret inside bold text shows
 * Bold pressed and clicking it removes the bold rather than adding more.
 */
export function FormatToolbar({ className = "" }: { className?: string }) {
  const [active, setActive] = useState<Record<string, boolean>>({});

  const refresh = useCallback(() => {
    if (typeof document.queryCommandState !== "function") return;
    const next: Record<string, boolean> = {};
    for (const { command } of RICH_COMMANDS) {
      try {
        next[command] = document.queryCommandState(command);
      } catch {
        // Firefox throws rather than returning false when there is no
        // editable selection; an unset button is the honest answer.
        next[command] = false;
      }
    }
    setActive(next);
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refresh);
    return () => document.removeEventListener("selectionchange", refresh);
  }, [refresh]);

  function apply(command: string) {
    document.execCommand(command);
    // The selection has not moved, so no selectionchange fires — without this
    // the button would not show the state it just produced.
    refresh();
  }

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="vertical"
      className={`flex flex-col gap-xs rounded-2xl border border-outline-variant/30 bg-surface p-xs ${className}`}
    >
      {RICH_COMMANDS.map(({ command, label, shortcut }) => {
        const Icon = ICON[command];
        const pressed = !!active[command];
        return (
          <button
            key={command}
            type="button"
            aria-label={`${label} (${shortcut})`}
            title={`${label} · ${shortcut}`}
            aria-pressed={pressed}
            // The caret must survive the click, or there is no selection left
            // for execCommand to act on.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(command)}
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${FOCUS_RING} ${
              pressed
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
            }`}
          >
            <Icon size={16} weight={pressed ? "bold" : "regular"} />
          </button>
        );
      })}
    </div>
  );
}
