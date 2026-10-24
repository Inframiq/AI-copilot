/**
 * Marks the product as a beta on every page: next to the wordmark where one
 * is shown, in the header otherwise. One component so the wording and look
 * stay the same everywhere, and so the badge comes off in one place.
 */
export const BETA_NOTE = "KripaX is in beta. Features may change, and some may not work as expected.";

export function BetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title={BETA_NOTE}
      data-testid="beta-badge"
      className={`inline-flex shrink-0 select-none items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wider text-primary ${className}`}
    >
      Beta
    </span>
  );
}
