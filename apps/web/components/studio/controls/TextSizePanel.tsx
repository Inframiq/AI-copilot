"use client";
import { useResumeStore } from "@/stores/resume-store";
import { FOCUS_RING, PRESS } from "@/lib/focus";

/** A point either side of the template's own sizes, which are "standard". */
const STEPS = [
  { label: "Small", delta: -1 },
  { label: "Standard", delta: 0 },
  { label: "Large", delta: 1 },
] as const;

/**
 * Text size, in two groups.
 *
 * Headings and body content move independently: shrinking the text to win
 * back a page should not shrink the section labels with it, and enlarging the
 * name should not push every bullet onto a second page.
 *
 * "Standard" is zero — the sizes each template already declares, which sit
 * inside the 10–12pt band résumé guidance asks for. So a résumé nobody has
 * touched is already at the ATS-safe size rather than needing this set.
 */
function SizeGroup({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (delta: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-xs">
      <div className="flex items-baseline justify-between gap-sm">
        <span className="text-label-sm font-semibold text-on-surface">{label}</span>
        <span className="text-caption text-on-surface-variant">{hint}</span>
      </div>
      <div className="grid grid-cols-3 gap-xs">
        {STEPS.map((step) => {
          const selected = value === step.delta;
          return (
            <button
              key={step.label}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(step.delta)}
              className={`rounded-xl border py-xs text-label-sm transition-colors ${PRESS} ${FOCUS_RING} ${
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-outline-variant/40 text-on-surface-variant hover:border-primary/40"
              }`}
            >
              {step.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TextSizePanel() {
  const headingSizeDelta = useResumeStore((s) => s.headingSizeDelta);
  const bodySizeDelta = useResumeStore((s) => s.bodySizeDelta);
  const setTextSize = useResumeStore((s) => s.setTextSize);

  return (
    <div className="flex flex-col gap-md">
      <SizeGroup
        label="Headings"
        hint="Your name and section titles"
        value={headingSizeDelta}
        onChange={(d) => setTextSize("heading", d)}
      />
      <SizeGroup
        label="Body text"
        hint="Every bullet and content line"
        value={bodySizeDelta}
        onChange={(d) => setTextSize("body", d)}
      />
    </div>
  );
}
