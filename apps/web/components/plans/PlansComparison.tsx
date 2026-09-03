"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, Lightning } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import type { Plan } from "@career-copilot/types";

interface Props {
  currentPlan?: string;
  onChoosePlan: (planId: string) => void;
  variant?: "full" | "compact";
}

export function PlansComparison({ currentPlan, onChoosePlan, variant = "full" }: Props) {
  const { data } = useQuery<{ plans: Plan[] }>({
    queryKey: ["plans"],
    queryFn: () => apiClient.getPlans(),
    staleTime: 5 * 60_000,
  });

  if (!data) {
    return (
      <div className="grid gap-gutter sm:grid-cols-2">
        <div className="h-72 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest animate-pulse" />
        <div className="h-72 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest animate-pulse" />
      </div>
    );
  }

  const compact = variant === "compact";

  return (
    <div className="grid gap-gutter sm:grid-cols-2">
      {data.plans.map((plan) => {
        const isCurrent = currentPlan === plan.id;
        const isPremium = plan.id === "premium";
        const features = compact ? plan.features.slice(0, 3) : plan.features;
        const label = isCurrent
          ? "Current plan"
          : isPremium
          ? "Get Premium"
          : "Continue on Free";

        return (
          <div
            key={plan.id}
            className={`rounded-2xl border p-lg flex flex-col ${
              isPremium
                ? "border-primary/40 bg-primary/[0.03] shadow-lg shadow-primary/5"
                : "border-outline-variant/20 bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between gap-sm">
              <h3 className="text-headline-md text-on-surface font-semibold">{plan.name}</h3>
              {isCurrent && (
                <span className="text-caption font-semibold px-sm py-[2px] rounded-full bg-secondary-container text-on-secondary-container">
                  Current plan
                </span>
              )}
            </div>

            <div className="mt-sm flex items-baseline gap-xs">
              <span className="text-headline-xl text-on-surface font-bold">
                {plan.price_usd === 0 ? "Free" : `$${plan.price_usd}`}
              </span>
              {plan.period && (
                <span className="text-body-md text-on-surface-variant">/ {plan.period}</span>
              )}
            </div>
            <p className="text-body-sm text-on-surface-variant mt-xs flex items-center gap-xs">
              <Lightning size={14} weight="fill" className="text-primary" />
              {plan.credits} credits{plan.refills ? " every month" : ", one-time"}
            </p>

            <ul className="mt-md flex flex-col gap-sm flex-1">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-sm text-body-sm text-on-surface">
                  <Check size={16} weight="bold" className="text-success-accent shrink-0 mt-[2px]" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => !isCurrent && onChoosePlan(plan.id)}
              disabled={isCurrent}
              className={`mt-lg py-md rounded-xl text-label-md font-semibold transition-colors ${
                isCurrent
                  ? "bg-surface-container text-on-surface-variant cursor-default"
                  : isPremium
                  ? "bg-primary text-on-primary hover:opacity-90"
                  : "border border-outline-variant/40 text-on-surface hover:bg-surface-container-high/50"
              }`}
            >
              {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
