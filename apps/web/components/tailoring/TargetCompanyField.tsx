"use client";
import { useState } from "react";
import { Check } from "@phosphor-icons/react";

/**
 * The optional "target company" for a tailoring run. With one set, the
 * pipeline also pulls that company's culture keywords and ATS phrases.
 *
 * Every way into tailoring shows it: Studio's paste form, and beside the
 * Tailor button on both JD pages — those start the run the moment the review
 * page opens, so this is the last place a company can be given.
 *
 * With `onSave`, a saved JD's pages also get a Save button, so the company
 * stays with that JD (`savedValue`) and prefills the next time.
 */
export function TargetCompanyField({
  id,
  value,
  onChange,
  savedValue,
  onSave,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  savedValue?: string | null;
  onSave?: (value: string) => Promise<void>;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const unchanged = value.trim() === (savedValue ?? "");

  async function save() {
    if (!onSave) return;
    setSaving(true);
    setError(false);
    try {
      await onSave(value.trim());
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`flex min-w-0 flex-col gap-xs ${className}`}>
      <label htmlFor={id} className="flex items-center gap-xs text-label-caps text-on-surface-variant">
        Target Company
        <span className="rounded-full bg-secondary-container px-xs py-xs text-caption font-semibold text-on-secondary-container">
          optional
        </span>
      </label>
      <div className="flex min-w-0 items-stretch gap-xs">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setError(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onSave && !unchanged && !saving) { e.preventDefault(); void save(); }
          }}
          placeholder="e.g. Google, Stripe…"
          maxLength={200}
          autoComplete="organization"
          className="w-full min-w-0 rounded-xl border border-outline-variant/50 bg-surface px-sm py-xs text-body-sm text-on-surface transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:px-md sm:py-sm sm:text-body-md"
        />
        {onSave && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={unchanged || saving}
            className={`flex shrink-0 items-center gap-xs rounded-xl px-sm text-label-sm transition-colors sm:px-md ${
              unchanged && savedValue
                ? "text-success cursor-default"
                : "border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            }`}
          >
            {unchanged && savedValue ? <><Check size={14} weight="bold" />Saved</> : saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {error && <p className="text-caption text-error">Couldn&apos;t save the company. Try again.</p>}
    </div>
  );
}
