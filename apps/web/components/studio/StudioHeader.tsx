"use client";
import { ArrowLeft, CircleNotch, DownloadSimple } from "@phosphor-icons/react";

export type StudioMode = "edit" | "preview";

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
  onExport,
  isExporting,
}: {
  title: string;
  mode: StudioMode;
  onMode: (m: StudioMode) => void;
  onBack: () => void;
  onExport: () => void;
  isExporting: boolean;
}) {
  return (
    <header className="flex shrink-0 items-center gap-lg border-b border-outline-variant/30 bg-surface px-lg py-sm">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-xs text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft size={16} />
        Back to Builder
      </button>

      <h1 className="truncate text-label-md font-semibold text-on-surface">{title}</h1>

      <div
        role="tablist"
        aria-label="Studio mode"
        className="ml-auto flex shrink-0 items-center gap-xs rounded-full bg-surface-container-low p-0.5"
      >
        {(["edit", "preview"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => onMode(m)}
            className={`rounded-full px-md py-xs text-label-sm capitalize transition-colors ${
              mode === m
                ? "bg-surface text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onExport}
        disabled={isExporting}
        className="flex shrink-0 items-center gap-xs rounded-xl bg-primary px-md py-sm text-label-md text-on-primary shadow-md transition-shadow hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isExporting ? (
          <CircleNotch size={16} className="animate-spin" />
        ) : (
          <DownloadSimple size={16} />
        )}
        Export PDF
      </button>
    </header>
  );
}
