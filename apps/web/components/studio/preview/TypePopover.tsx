"use client";
import { useEffect, useRef, useState } from "react";
import { TextAa, Check } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";

// Every stack ends in a bare generic (sans-serif/serif) deliberately — must
// match FONT_STACKS in apps/api/app/services/pdf.py exactly, both in keys
// and in which generic each ends with (the render host has no font packages
// installed, so only the trailing generic keyword is guaranteed to resolve).
export const FONT_CHOICES = [
  { value: "sans", label: "Sans" },
  { value: "modern_sans", label: "Modern Sans" },
  { value: "serif", label: "Serif" },
  { value: "classic_serif", label: "Classic Serif" },
] as const;

// Mirrors TEMPLATE_DEFAULT_ACCENT in apps/api/app/services/pdf.py — only
// used so the color picker shows the template's actual current accent
// instead of an arbitrary color when the user hasn't overridden it yet.
export const TEMPLATE_DEFAULT_ACCENT: Record<string, string> = {
  ats_clean: "#111111",
  ats_modern: "#5c6bc0",
  ats_sidebar: "#4c6178",
  ats_professional: "#1f5fbf",
  ats_minimal: "#1a1a1a",
};

// Browser-safe approximations of each PDF stack, for the specimen row only —
// this map never leaves the browser and is never sent to the backend; the
// stored fontChoice is always the FONT_CHOICES key above.
const SPECIMEN_STACKS: Record<(typeof FONT_CHOICES)[number]["value"], string> = {
  sans: "Arial, Helvetica, sans-serif",
  modern_sans: "'Segoe UI', 'Helvetica Neue', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  classic_serif: "'Times New Roman', Times, serif",
};

// Reads/writes the resume store directly — replaces the font <select> and
// accent color swatch that used to sit in PreviewPanel's wrapping control
// bar. Self-contained: trigger + popover in one component, so DockToolbar
// just drops it in.
export function TypePopover() {
  const templateId = useResumeStore((s) => s.templateId);
  const fontChoice = useResumeStore((s) => s.fontChoice);
  const accentColor = useResumeStore((s) => s.accentColor);
  const setFontChoice = useResumeStore((s) => s.setFontChoice);
  const setAccentColor = useResumeStore((s) => s.setAccentColor);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Type"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
          open ? "bg-primary/20 text-primary" : "text-on-desk hover:bg-desk-line/60"
        }`}
      >
        <TextAa size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Type settings"
          className="absolute bottom-full left-1/2 mb-sm w-64 -translate-x-1/2 flex flex-col gap-xs rounded-2xl border border-desk-line bg-desk-raised p-md shadow-2xl"
        >
          <ul className="flex flex-col gap-xs">
            {FONT_CHOICES.map((f) => {
              const selected = f.value === fontChoice;
              return (
                <li key={f.value}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setFontChoice(f.value)}
                    className={`flex w-full items-center justify-between rounded-xl px-sm py-sm transition-colors ${
                      selected ? "bg-primary/20 text-primary" : "text-on-desk hover:bg-desk-line/60"
                    }`}
                  >
                    <span className="text-body-md" style={{ fontFamily: SPECIMEN_STACKS[f.value] }}>
                      {f.label}
                    </span>
                    {selected && <Check size={14} weight="bold" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-xs h-px bg-desk-line" />

          <label className="flex items-center justify-between gap-sm px-sm">
            <span className="text-label-sm text-on-desk">Accent color</span>
            <input
              aria-label="Accent color"
              type="color"
              value={accentColor ?? TEMPLATE_DEFAULT_ACCENT[templateId] ?? "#111111"}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded-md border border-desk-line bg-transparent p-0"
            />
          </label>
        </div>
      )}
    </div>
  );
}
