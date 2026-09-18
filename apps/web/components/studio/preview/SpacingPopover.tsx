"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowsOutLineVertical, CaretDown, CaretRight } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";

// Real resume-formatting guidance (Teal, WashU Career Engagement, Hireflow —
// see the commit that introduced this) converges on: 1.0-1.15 line spacing
// within bullets/body text, 8-12pt after each section, and section-to-
// section separation running 1.5-2x that. These three presets are single
// values within (Compact, Standard) or just past (Spacious) that range,
// snapped to the sliders' step sizes (0.05 / 2px) so picking one lands
// exactly on a reachable slider position, not an in-between value the
// slider itself could never produce.
export const SPACING_PRESETS = [
  { label: "Compact", lineSpacing: 1.0, paragraphSpacing: 8 },
  { label: "Standard", lineSpacing: 1.15, paragraphSpacing: 12 },
  { label: "Spacious", lineSpacing: 1.4, paragraphSpacing: 18 },
] as const;

// A density card is judged by eye, not by its numbers — three bars drawn at
// the preset's actual line-height ratio let "Compact" vs. "Spacious" read as
// a visibly different rhythm before either is ever applied to the resume.
function DensityGlyph({ lineSpacing }: { lineSpacing: number }) {
  return (
    <span
      className="flex w-full flex-col"
      style={{ gap: `${Math.round((lineSpacing - 1) * 12 + 2)}px` }}
    >
      <span className="h-0.5 w-full rounded-full bg-on-desk/70" />
      <span className="h-0.5 w-full rounded-full bg-on-desk/70" />
      <span className="h-0.5 w-3/4 rounded-full bg-on-desk/70" />
    </span>
  );
}

// Reads/writes the resume store directly — replaces the spacing preset
// dropdown and its two range inputs that used to sit in PreviewPanel's
// wrapping control bar. Self-contained: trigger + popover in one component,
// so DockToolbar just drops it in.
export function SpacingPopover() {
  const lineSpacing = useResumeStore((s) => s.lineSpacing);
  const paragraphSpacing = useResumeStore((s) => s.paragraphSpacing);
  const setSpacing = useResumeStore((s) => s.setSpacing);

  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activePreset = SPACING_PRESETS.find(
    (p) => p.lineSpacing === lineSpacing && p.paragraphSpacing === paragraphSpacing
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Spacing"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
          open ? "bg-primary/20 text-primary" : "text-on-desk hover:bg-desk-line/60"
        }`}
      >
        <ArrowsOutLineVertical size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Spacing settings"
          className="absolute bottom-full left-1/2 mb-sm w-64 -translate-x-1/2 flex flex-col gap-sm rounded-2xl border border-desk-line bg-desk-raised p-md shadow-2xl"
        >
          <div className="grid grid-cols-3 gap-xs">
            {SPACING_PRESETS.map((p) => {
              const selected = p.label === activePreset?.label;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setSpacing(p.lineSpacing, p.paragraphSpacing)}
                  className={`flex flex-col items-center gap-xs rounded-xl border p-sm transition-colors ${
                    selected ? "border-primary bg-primary/10" : "border-desk-line hover:border-on-desk/50"
                  }`}
                >
                  <DensityGlyph lineSpacing={p.lineSpacing} />
                  <span className={`text-caption ${selected ? "text-primary" : "text-on-desk"}`}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setCustomOpen((o) => !o)}
            aria-expanded={customOpen}
            className="flex items-center gap-xs text-label-sm text-on-desk transition-colors hover:text-white"
          >
            {customOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
            Custom
          </button>

          {customOpen && (
            <div className="flex flex-col gap-sm">
              <label className="flex flex-col gap-xs text-label-sm text-on-desk">
                <span className="flex items-center justify-between">
                  Line spacing
                  <span className="tabular">{lineSpacing.toFixed(2)}</span>
                </span>
                <input
                  aria-label="Line spacing"
                  type="range"
                  min={1}
                  max={1.6}
                  step={0.05}
                  value={lineSpacing}
                  onChange={(e) => setSpacing(parseFloat(e.target.value), paragraphSpacing)}
                  className="w-full accent-primary"
                />
              </label>
              <label className="flex flex-col gap-xs text-label-sm text-on-desk">
                <span className="flex items-center justify-between">
                  Paragraph spacing
                  <span className="tabular">{paragraphSpacing}px</span>
                </span>
                <input
                  aria-label="Paragraph spacing"
                  type="range"
                  min={0}
                  max={24}
                  step={2}
                  value={paragraphSpacing}
                  onChange={(e) => setSpacing(lineSpacing, parseInt(e.target.value, 10))}
                  className="w-full accent-primary"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
