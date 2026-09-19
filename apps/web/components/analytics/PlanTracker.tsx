"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { track } from "@vercel/analytics";
import { apiClient } from "@/lib/api-client";
import type { Subscription } from "@career-copilot/types";

// Kept in memory, never in browser storage: storage used only for
// analytics is the kind that would need a consent banner, and the site sets
// nothing that isn't strictly necessary (see /cookies).
let trackedPlan: string | null = null;

/**
 * Fires one Vercel Analytics custom event per page load carrying the
 * signed-in user's plan, so Free vs Premium shows up as a breakdown on the
 * "plan_seen" event in the Vercel Analytics dashboard. Renders nothing.
 */
export function PlanTracker() {
  const { data } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!data) return;
    if (trackedPlan === data.plan) return;
    track("plan_seen", { plan: data.plan });
    trackedPlan = data.plan;
  }, [data]);

  return null;
}
