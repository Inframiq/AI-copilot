"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import type { Plan, Subscription } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";

/** A plan from the server's catalog, by id. */
function usePlan(id: "free" | "premium"): Plan | null {
  const { data } = useQuery<{ plans: Plan[] }>({
    queryKey: ["plans"],
    queryFn: () => apiClient.getPlans(),
    staleTime: 60 * 60 * 1000,
  });
  return data?.plans.find((p) => p.id === id) ?? null;
}

/** When a paid plan's credits come back, as words ("12 Nov"). */
export function refillDate(sub: Subscription | undefined): string | null {
  if (!sub?.renews || !sub.current_period_end) return null;
  return new Date(sub.current_period_end).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Every plan is the same app with a different number of credits, so the
 * way out of running short depends only on the plan: Free upgrades,
 * Premium renews (a fresh allowance now, or Premium back after it ended). */
export function creditPath(sub: Subscription | undefined): "upgrade" | "renew" {
  return sub && sub.plan !== "free" ? "renew" : "upgrade";
}

/**
 * What running short of credits offers: "Upgrade to Premium" on Free,
 * "Renew Premium" on Premium — price and allowance from the server's
 * catalog, so it never disagrees with the Plans page.
 */
export function PremiumOffer({ subscription, onNavigate }: { subscription?: Subscription; onNavigate?: () => void }) {
  const premium = usePlan("premium");
  const free = usePlan("free");
  const path = creditPath(subscription);
  const ended = path === "renew" && subscription?.status !== "active";
  const when = path === "renew" && !ended ? refillDate(subscription) : null;
  const price = premium ? ` · $${premium.price_usd} a ${premium.period ?? "month"}` : "";
  const allowance = premium ? `${premium.credits} credits` : "A fresh credit allowance";

  return (
    <div className="rounded-xl border border-primary/25 bg-primary-fixed/40 p-md flex flex-col gap-sm">
      <div className="flex items-start gap-sm">
        <Sparkle size={18} weight="fill" className="shrink-0 mt-0.5 text-primary" />
        <div className="min-w-0">
          <p className="text-label-md text-on-surface">
            {path === "upgrade" ? `Premium${price}` : ended ? "Premium has ended" : `Renew Premium${price}`}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            {path === "upgrade"
              ? `${allowance} every 30 days${free ? `, instead of a one-time ${free.credits}` : ""} — enough for an active job search.`
              : ended
                ? `Renew to get ${premium ? `${premium.credits} credits` : "your credits"} every 30 days again.`
                : `${allowance} now, starting a new 30-day period${when ? ` (otherwise they refill on ${when})` : ""}.`}
          </p>
        </div>
      </div>
      <Link
        href="/plans"
        onClick={onNavigate}
        data-autofocus
        className={`inline-flex items-center justify-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md text-on-primary hover:bg-primary-container transition-colors ${FOCUS_RING}`}
      >
        {path === "upgrade" ? "Upgrade to Premium" : "Renew Premium"} <ArrowRight size={14} />
      </Link>
    </div>
  );
}
