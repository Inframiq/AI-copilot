"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Plan, Subscription } from "@career-copilot/types";
import { PlansComparison, plansQuery } from "@/components/plans/PlansComparison";
import { settled, subscriptionQuery, usePageReady } from "@/lib/reveal";
import { UpgradeModal } from "@/components/plans/UpgradeModal";

export default function PlansPage() {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const subQuery = useQuery<Subscription>(subscriptionQuery);
  const sub = subQuery.data;
  const plans = useQuery<{ plans: Plan[] }>(plansQuery);
  // The plans, which one is yours, and the shell appear together (lib/reveal).
  const ready = usePageReady(settled(subQuery, plans));

  const header = (
    <section className="pt-xs sm:pt-lg sm:pb-md">
      <h1
        className="text-headline-xl text-on-surface font-bold mb-sm"
        style={{ letterSpacing: "-0.02em" }}
      >
        Plans
      </h1>
      <p className="text-body-md sm:text-body-lg text-on-surface-variant">
        Compare credit allowances and included features.
      </p>
    </section>
  );

  if (!ready) {
    return (
      <div className="w-full min-w-0 max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
        {header}
        <div aria-hidden className="grid grid-cols-2 gap-gutter">
          <div className="skeleton h-72 rounded-2xl" />
          <div className="skeleton h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      {header}

      <PlansComparison
        variant="full"
        currentPlan={sub?.plan}
        onChoosePlan={(id) => {
          if (id === "premium") setShowUpgrade(true);
        }}
      />

      {sub?.costs && (
        <p className="text-caption text-on-surface-variant -mt-md">
          Credits are shared across all actions; each figure above assumes the whole allowance is used
          for that action alone. Full rates are listed under Credit Utilization in{" "}
          <Link href="/account" className="text-primary hover:underline">Account</Link>.
        </p>
      )}

      {showUpgrade && (
        <UpgradeModal mode={sub && sub.plan !== "free" ? "renew" : "upgrade"} onClose={() => setShowUpgrade(false)} />
      )}
    </div>
  );
}
