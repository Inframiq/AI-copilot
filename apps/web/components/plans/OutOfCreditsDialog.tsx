"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Subscription } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet } from "@/components/ui/Sheet";
import { PremiumOffer } from "@/components/plans/PremiumOffer";
import { clearCreditRefusal, useCreditsStore } from "@/stores/credits-store";

/**
 * Shown whenever the server refuses an action for lack of credits, wherever
 * it happened: what was refused, what it costs against what is left, and
 * the way out — Premium for a free account, the refill date on a paid one.
 * Mounted once per layout; the refusal arrives through the API client.
 */
export function OutOfCreditsDialog() {
  const queryClient = useQueryClient();
  const refusal = useCreditsStore((s) => s.refusal);
  const { data: subscription } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
    enabled: !!refusal,
  });

  // The balance in the header is stale the moment the server says no.
  useEffect(() => {
    if (refusal) void queryClient.invalidateQueries({ queryKey: ["subscription"] });
  }, [refusal, queryClient]);

  if (!refusal) return null;
  const ended = refusal.kind === "inactive";

  return (
    <Sheet labelledBy="out-of-credits-title" describedBy="out-of-credits-help" onClose={clearCreditRefusal}>
      <div className="px-md sm:px-lg pt-md sm:pt-lg pb-md sm:pb-lg flex flex-col gap-md">
        <div className="pr-xl">
          <p className="font-label-caps text-label-caps uppercase text-error">
            {ended ? "Plan not active" : "Out of credits"}
          </p>
          <h2 id="out-of-credits-title" className="mt-sm text-headline-md text-on-surface">
            {ended ? "Your plan has ended" : "Not enough credits for this"}
          </h2>
          <p id="out-of-credits-help" className="mt-xs text-body-sm text-on-surface-variant">
            Nothing was charged and nothing changed.
          </p>
        </div>

        {refusal.kind === "credits" && (
          <div className="flex items-center justify-between gap-md border-y border-outline-variant/40 py-sm">
            <span className="min-w-0 text-body-sm text-on-surface">{refusal.action}</span>
            <span className="shrink-0 text-right tabular-nums">
              {refusal.cost !== null && <span className="block text-label-md text-on-surface">{refusal.cost} credits</span>}
              {refusal.have !== null && <span className="block text-caption text-error">You have {refusal.have}</span>}
            </span>
          </div>
        )}

        <PremiumOffer subscription={subscription} onNavigate={clearCreditRefusal} />

        <button
          type="button"
          onClick={clearCreditRefusal}
          className={`self-center px-md py-xs rounded-lg text-label-md text-on-surface-variant hover:text-on-surface ${FOCUS_RING}`}
        >
          Not now
        </button>
      </div>
    </Sheet>
  );
}
