"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Lightning } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import type { Subscription } from "@career-copilot/types";

/**
 * The signed-in user's credit balance. `compact` sits in the top bar,
 * `full` is the card in the sidebar. Both link to /account. Renders nothing
 * until the balance has loaded, so it never flashes a placeholder number.
 */
export function CreditMeter({ variant = "compact" }: { variant?: "compact" | "full" }) {
  const { data } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
    staleTime: 30_000,
  });

  if (!data) return null;

  const { credits_remaining, credits_allotment, plan } = data;
  const tailorCost = data.costs?.tailor ?? 10;
  const low = credits_remaining < tailorCost;
  const pct =
    credits_allotment > 0
      ? Math.max(0, Math.min(100, (credits_remaining / credits_allotment) * 100))
      : 0;

  if (variant === "compact") {
    return (
      <Link
        href="/account"
        title={`${credits_remaining} of ${credits_allotment} credits`}
        aria-label={`${credits_remaining} credits remaining`}
        className={`flex items-center gap-xs px-md py-xs pill pill-interactive rounded-full border text-label-sm font-semibold transition-colors ${
          low
            ? "border-error/40 text-error bg-error/5 hover:bg-error/10"
            : "border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high/50"
        }`}
      >
        <Lightning size={16} weight="fill" className={low ? "text-error" : "text-primary"} />
        {credits_remaining}
        <span className="hidden lg:inline text-on-surface-variant/60 font-normal">
          / {credits_allotment}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/account"
      className="block rounded-xl border border-outline-variant/30 bg-surface-container-low/60 px-md py-sm hover:bg-surface-container-high/40 transition-colors"
    >
      <div className="flex items-center justify-between mb-xs">
        <span className="text-label-sm text-on-surface-variant flex items-center gap-xs">
          <Lightning size={14} weight="fill" className={low ? "text-error" : "text-primary"} />
          Credits
        </span>
        <span className={`text-label-sm font-bold ${low ? "text-error" : "text-on-surface"}`}>
          {credits_remaining}
          <span className="text-on-surface-variant/60 font-normal"> / {credits_allotment}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${low ? "bg-error" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-caption text-on-surface-variant/70 capitalize">{plan} plan</span>
    </Link>
  );
}
