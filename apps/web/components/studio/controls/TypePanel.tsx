"use client";
import { useEffect } from "react";
import { Check } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { RESUME_FONT_STACKS, ensureResumeFonts } from "@/lib/resume-fonts";
import { accentReadsOnWhite } from "@/lib/accent-contrast";

// Keys must match FONT_STACKS in apps/api/app/services/pdf.py; each draws
// with the font bundled for the PDF (lib/resume-fonts).
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
  ats_executive: "#2f4858",
  ats_compact: "#37474f",
  ats_banner: "#1f3b73",
  ats_portrait: "#6d4c41",
  ats_technical: "#00695c",
};


// Font and accent for the document on screen, read and written straight
// through resume-store. The panel body only: StudioControls owns the trigger
// and the popover around it, so this is the same content wherever it sits.
export function TypePanel() {
  const templateId = useResumeStore((s) => s.templateId);
  const fontChoice = useResumeStore((s) => s.fontChoice);
  const accentColor = useResumeStore((s) => s.accentColor);
  const setFontChoice = useResumeStore((s) => s.setFontChoice);
  const setAccentColor = useResumeStore((s) => s.setAccentColor);
  // The specimens draw in the résumé's own fonts.
  useEffect(ensureResumeFonts, []);
  const tooLight = accentColor !== null && !accentReadsOnWhite(accentColor);

  return (
    <div className="flex flex-col gap-xs">

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
                selected ? "bg-primary/20 text-primary" : "text-on-surface-variant hover:bg-surface-container-low"
              }`}
            >
              <span className="text-body-md" style={{ fontFamily: RESUME_FONT_STACKS[f.value] }}>
                {f.label}
              </span>
              {selected && <Check size={14} weight="bold" />}
            </button>
          </li>
        );
      })}
    </ul>

    <div className="my-xs h-px bg-outline-variant/40" />

    <label className="flex items-center justify-between gap-sm px-sm">
      <span className="text-label-sm text-on-surface-variant">Accent color</span>
      <input
        aria-label="Accent color"
        type="color"
        value={accentColor ?? TEMPLATE_DEFAULT_ACCENT[templateId] ?? "#111111"}
        onChange={(e) => setAccentColor(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded-md border border-outline-variant/40 bg-transparent p-0"
      />
    </label>
    {tooLight && (
      <p role="status" className="px-sm text-caption text-on-surface-variant">
        Too light to read on white. The template&apos;s own colour is used in the PDF.
      </p>
    )}
    </div>
  );
}
