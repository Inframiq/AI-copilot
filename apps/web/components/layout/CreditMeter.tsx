"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightning } from "@phosphor-icons/react";
import { subscriptionQuery, useShellRevealed } from "@/lib/reveal";
import type { Subscription } from "@career-copilot/types";

/** Stands in, unseen, for the balance while it loads — two-digit numbers, so
 * the placeholder is the width the real meter will be. */
const PLACEHOLDER: Subscription = {
  plan: "free",
  status: "active",
  credits_remaining: 50,
  credits_allotment: 50,
  current_period_end: null,
  renews: false,
  costs: { tailor: 10, cover_letter: 3, rewrite_bullet: 1, analyze: 0 },
};

/** The meter's link, or while loading a shimmering box of its exact size with
 * nothing readable in it — never a made-up number. */
function MeterBox({ ghost, className, summary, children }: {
  ghost: boolean;
  className: string;
  summary?: string;
  children: ReactNode;
}) {
  if (ghost) {
    return (
      <div aria-hidden className={`${className} skeleton border-transparent! pointer-events-none`}>
        <span className="contents invisible">{children}</span>
      </div>
    );
  }
  return (
    <Link href="/account" title={summary} aria-label={summary} className={className}>
      {children}
    </Link>
  );
}

/**
 * The signed-in user's credit balance. `compact` sits in the top bar,
 * `full` is the card in the sidebar. Both link to /account. Until the balance
 * — and the rest of the shell (lib/reveal) — has loaded it is a placeholder
 * of the same size, so nothing moves when it arrives.
 */
export function CreditMeter({
  variant = "compact",
}: {
  /** "rail" is the collapsed-sidebar form: the rail is 72px and the aside's
   * own padding leaves ~40px of usable width, where "compact" (px-md + icon +
   * count + "/ allotment") needs roughly 100px and spills out. */
  variant?: "compact" | "full" | "rail";
}) {
  const { data: loaded } = useQuery<Subscription>(subscriptionQuery);
  const revealed = useShellRevealed();
  const ghost = !loaded || !revealed;
  const data = ghost ? PLACEHOLDER : loaded;

  const { credits_remaining, credits_allotment, plan } = data;
  const tailorCost = data.costs?.tailor ?? 10;
  const low = credits_remaining < tailorCost;
  // Always "left": a bare "34 / 50" reads as either used or remaining.
  const summary = `${credits_remaining} of ${credits_allotment} credits left`;
  const pct =
    credits_allotment > 0
      ? Math.max(0, Math.min(100, (credits_remaining / credits_allotment) * 100))
      : 0;

  if (variant === "rail") {
    return (
      <MeterBox
        ghost={ghost}
        summary={summary}
        className={`flex flex-col items-center justify-center gap-0.5 px-0 py-xs rounded-lg border text-label-sm font-semibold transition-colors ${
          low
            ? "border-error/40 text-error bg-error/5 hover:bg-error/10"
            : "border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high/50"
        }`}
      >
        <Lightning size={16} weight="fill" className={low ? "text-error" : "text-primary"} />
        {/* Remaining only — the "/ allotment" is what made this too wide.
            Both numbers stay in the tooltip and the accessible name. */}
        {credits_remaining}
      </MeterBox>
    );
  }

  if (variant === "compact") {
    return (
      <MeterBox
        ghost={ghost}
        summary={summary}
        className={`shrink-0 whitespace-nowrap flex items-center gap-xs px-sm sm:px-md py-xs pill pill-interactive rounded-full border text-label-sm font-semibold transition-colors ${
          low
            ? "border-error/40 text-error bg-error/5 hover:bg-error/10"
            : "border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high/50"
        }`}
      >
        <Lightning size={16} weight="fill" className={low ? "text-error" : "text-primary"} />
        {/* A phone's top bar also holds search, help, feedback and the
            avatar: there the count stands alone, as on the sidebar rail.
            The tooltip and accessible name keep the full sentence. */}
        <span>
          {credits_remaining}
          <span className="hidden lg:inline text-on-surface-variant/60 font-normal">
            {" "}of {credits_allotment}
          </span>
          <span className="hidden sm:inline font-normal"> left</span>
        </span>
      </MeterBox>
    );
  }

  return (
    <MeterBox
      ghost={ghost}
      className="block rounded-xl border border-outline-variant/30 bg-surface-container-low/60 px-md py-sm hover:bg-surface-container-high/40 transition-colors"
    >
      <div className="flex items-center justify-between mb-xs">
        <span className="text-label-sm text-on-surface-variant flex items-center gap-xs">
          <Lightning size={14} weight="fill" className={low ? "text-error" : "text-primary"} />
          Credits left
        </span>
        <span className={`text-label-sm font-bold ${low ? "text-error" : "text-on-surface"}`}>
          {credits_remaining}
          <span className="text-on-surface-variant/60 font-normal"> of {credits_allotment}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${low ? "bg-error" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-caption text-on-surface-variant/70 capitalize">{plan} plan</span>
    </MeterBox>
  );
}
