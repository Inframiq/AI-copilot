"use client";
import { ArrowLeft, CircleNotch, DownloadSimple } from "@phosphor-icons/react";
import { FOCUS_RING } from "@/lib/focus";
import { StudioControls } from "./StudioControls";

export type StudioMode = "edit" | "preview";

const MODES = ["edit", "preview"] as const;

/**
 * Minimal chrome for the Studio: back, the two modes, export.
 *
 * The document is the interface, so nothing here competes with it. Edit and
 * Preview are separate modes rather than one blended view because they are
 * different jobs — changing copy, and checking exactly what will export.
 */
export function StudioHeader({
  title,
  mode,
  onMode,
  onBack,
  backLabel,
  onExport,
  isExporting,
}: {
  title: string;
  mode: StudioMode;
  onMode: (m: StudioMode) => void;
  onBack: () => void;
  /** Path-specific: the JD path came through the review, not the Builder. */
  backLabel: string;
  onExport: () => void;
  isExporting: boolean;
}) {
  // The ARIA tablist pattern: arrows move between tabs and wrap, and only the
  // active tab sits in the tab order. Declaring role="tab" without this tells
  // a screen-reader user to reach for keys that do nothing.
  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + MODES.length) % MODES.length;
    onMode(MODES[next]);
    const sibling = event.currentTarget.parentElement?.children[next];
    if (sibling instanceof HTMLElement) sibling.focus();
  }

  return (
    <header className="flex shrink-0 items-center gap-lg border-b border-outline-variant/30 bg-surface px-lg py-sm">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className={`flex shrink-0 items-center gap-xs rounded-lg text-label-md text-on-surface-variant transition-colors hover:text-on-surface ${FOCUS_RING}`}
      >
        <ArrowLeft size={16} />
        {/* Back, title, two tabs and Export do not fit a phone; the two text
            labels collapse to their icons and keep their names via aria. */}
        <span className="hidden sm:inline">{backLabel}</span>
      </button>

      <h1 className="truncate text-label-md font-semibold text-on-surface">{title}</h1>

      <div
        role="tablist"
        aria-label="Studio mode"
        className="ml-auto flex shrink-0 items-center gap-xs rounded-full bg-surface-container-low p-0.5"
      >
        {MODES.map((m, index) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            tabIndex={mode === m ? 0 : -1}
            onClick={() => onMode(m)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`rounded-full px-md py-xs text-label-sm capitalize transition-colors ${FOCUS_RING} ${
              mode === m
                ? "bg-surface text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <StudioControls />

      <button
        type="button"
        onClick={onExport}
        disabled={isExporting}
        aria-label="Export PDF"
        className={`flex shrink-0 items-center gap-xs rounded-xl bg-primary px-md py-sm text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        {isExporting ? (
          <CircleNotch size={16} className="animate-spin" />
        ) : (
          <DownloadSimple size={16} />
        )}
        <span className="hidden sm:inline">Export PDF</span>
      </button>
    </header>
  );
}
