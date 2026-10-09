"use client";

/**
 * The optional "target company" for a tailoring run. With one set, the
 * pipeline also pulls that company's culture keywords and ATS phrases.
 *
 * Every way into tailoring shows it: Studio's paste form, and beside the
 * Tailor button on both JD pages — those start the run the moment the review
 * page opens, so this is the last place a company can be given.
 */
export function TargetCompanyField({
  id,
  value,
  onChange,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-xs ${className}`}>
      <label htmlFor={id} className="flex items-center gap-xs text-label-caps text-on-surface-variant">
        Target Company
        <span className="rounded-full bg-secondary-container px-xs py-xs text-caption font-semibold text-on-secondary-container">
          optional
        </span>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Google, Stripe…"
        maxLength={200}
        autoComplete="organization"
        className="w-full min-w-0 rounded-xl border border-outline-variant/50 bg-surface px-sm py-xs text-body-sm text-on-surface transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:px-md sm:py-sm sm:text-body-md"
      />
    </div>
  );
}
