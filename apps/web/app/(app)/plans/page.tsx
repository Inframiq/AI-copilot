"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Subscription } from "@career-copilot/types";
import { PlansComparison } from "@/components/plans/PlansComparison";
import { UpgradeModal } from "@/components/plans/UpgradeModal";

export default function PlansPage() {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const { data: sub } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
  });

  return (
    <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      <section className="pt-lg pb-md">
        <h1
          className="text-headline-xl text-on-surface font-bold mb-sm"
          style={{ letterSpacing: "-0.02em" }}
        >
          Plans
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Pick the plan that fits how much you tailor.
        </p>
      </section>

      <PlansComparison
        variant="full"
        currentPlan={sub?.plan}
        onChoosePlan={(id) => {
          if (id === "premium") setShowUpgrade(true);
        }}
      />

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
