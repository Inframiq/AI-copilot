"use client";
import { useState } from "react";
import { Check, FloppyDisk } from "@phosphor-icons/react";

/**
 * The optional "target company" for a tailoring run. With one set, the
 * pipeline also pulls that company's culture keywords and ATS phrases.
 *
 * Every way into tailoring shows it: Studio's paste form, and beside the
 * Tailor button on both JD pages — those start the run the moment the review
 * page opens, so this is the last place a company can be given.
 *
 * With `onSave`, a saved JD's pages also get a Save button, so the company
 * stays with that JD (`savedValue`) and prefills the next time. A JD not
 * saved yet passes `unsavedNote` instead: the button still shows, greyed,
 * with the note saying when the company will be kept.
 */
export function TargetCompanyField({
  id,
  value,
  onChange,
  savedValue,
  onSave,
  unsavedNote,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  savedValue?: string | null;
  onSave?: (value: string) => Promise<void>;
  unsavedNote?: string;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const unchanged = value.trim() === (savedValue ?? "");
  const saved = unchanged && !!savedValue;

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
        {(onSave || unsavedNote) && (
          // A square icon on phones, where the JD card is too narrow for a
          // label beside the input; "Save" / "Saved" from sm up.
          <button
            type="button"
            onClick={() => void save()}
            disabled={!onSave || unchanged || saving}
            aria-label={saved ? "Company saved" : saving ? "Saving company" : "Save company"}
            title={!onSave ? unsavedNote : saved ? "Saved to this job" : "Save the company to this job"}
            className={`flex w-9 shrink-0 items-center justify-center gap-xs rounded-xl text-label-sm transition-colors sm:w-auto sm:min-w-[5.5rem] sm:px-md ${
              saved
                ? "text-success cursor-default"
                : "border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            }`}
          >
            {saved ? <Check size={16} weight="bold" /> : <FloppyDisk size={16} className="sm:hidden" />}
            <span className="hidden sm:inline">{saved ? "Saved" : saving ? "Saving…" : "Save"}</span>
          </button>
        )}
      </div>
      {!onSave && unsavedNote && value.trim() && (
        <p className="text-caption text-on-surface-variant">{unsavedNote}</p>
      )}
      {error && <p className="text-caption text-error">Couldn&apos;t save the company. Try again.</p>}
    </div>
  );
}
