"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { track } from "@vercel/analytics";
import { apiClient } from "@/lib/api-client";
import type { Subscription } from "@career-copilot/types";

const SESSION_FLAG = "kripax_plan_tracked";

/**
 * Fires one Vercel Analytics custom event per browser session carrying the
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
    if (sessionStorage.getItem(SESSION_FLAG) === data.plan) return;
    track("plan_seen", { plan: data.plan });
    sessionStorage.setItem(SESSION_FLAG, data.plan);
  }, [data]);

  return null;
}
