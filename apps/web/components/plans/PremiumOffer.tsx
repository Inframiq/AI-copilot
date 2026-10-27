"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import type { Plan, Subscription } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";

/** The plan a free account would move to, from the server's catalog. */
export function usePremiumPlan(): Plan | null {
  const { data } = useQuery<{ plans: Plan[] }>({
    queryKey: ["plans"],
    queryFn: () => apiClient.getPlans(),
    staleTime: 60 * 60 * 1000,
  });
  return data?.plans.find((p) => p.id === "premium") ?? null;
}

/** When a paid plan's credits come back, as words ("on 12 Nov"). */
export function refillDate(sub: Subscription | undefined): string | null {
  if (!sub?.renews || !sub.current_period_end) return null;
  return new Date(sub.current_period_end).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * What running out of credits offers: Premium for a free account — price
 * and allowance from the server's catalog, so it never disagrees with the
 * Plans page — or, on a paid plan, when the credits come back.
 */
export function PremiumOffer({ subscription, onNavigate }: { subscription?: Subscription; onNavigate?: () => void }) {
  const premium = usePremiumPlan();
  if (subscription && subscription.plan !== "free") {
    const when = refillDate(subscription);
    return (
      <p className="rounded-xl bg-surface-container-low px-md py-sm text-body-sm text-on-surface">
        {when ? `Your ${subscription.credits_allotment} credits refill on ${when}.` : "Your credits refill with your next billing period."}
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-primary/25 bg-primary-fixed/40 p-md flex flex-col gap-sm">
      <div className="flex items-start gap-sm">
        <Sparkle size={18} weight="fill" className="shrink-0 mt-0.5 text-primary" />
        <div className="min-w-0">
          <p className="text-label-md text-on-surface">
            Premium{premium ? ` · $${premium.price_usd} a ${premium.period ?? "month"}` : ""}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            {premium
              ? `${premium.credits} credits every 30 days — enough for an active job search.`
              : "A monthly credit allowance for an active job search."}
          </p>
        </div>
      </div>
      <Link
        href="/plans"
        onClick={onNavigate}
        data-autofocus
        className={`inline-flex items-center justify-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md text-on-primary hover:bg-primary-container transition-colors ${FOCUS_RING}`}
      >
        See Premium <ArrowRight size={14} />
      </Link>
    </div>
  );
}
