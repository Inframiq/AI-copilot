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
      <div className="grid grid-cols-2 gap-gutter">
        <div className="h-72 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest animate-pulse" />
        <div className="h-72 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest animate-pulse" />
      </div>
    );
  }

  const compact = variant === "compact";

  return (
    <div className="grid grid-cols-2 gap-gutter">
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
            className={`min-w-0 rounded-2xl border p-md sm:p-lg flex flex-col ${
              isPremium
                ? "border-primary/40 bg-primary/[0.03] shadow-lg shadow-primary/5"
                : "border-outline-variant/20 bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between gap-sm">
              <h3 className="text-headline-md text-on-surface font-semibold">{plan.name}</h3>
              {isCurrent && (
                <span className="shrink-0 text-caption font-semibold px-sm py-[2px] pill rounded-full bg-secondary-container text-on-secondary-container">
                  <span className="sm:hidden">Current</span>
                  <span className="hidden sm:inline">Current plan</span>
                </span>
              )}
            </div>

            <div className="mt-xs sm:mt-sm flex flex-wrap items-baseline gap-x-xs">
              <span className="text-headline-xl text-on-surface font-bold">
                {plan.price_usd === 0 ? "Free" : `$${plan.price_usd}`}
              </span>
              {plan.period && (
                <span className="text-body-md text-on-surface-variant">/ {plan.period}</span>
              )}
            </div>
            <p className="text-body-sm text-on-surface-variant mt-xs flex items-start sm:items-center gap-xs leading-tight">
              <Lightning size={14} weight="fill" className="text-primary shrink-0" />
              {plan.credits} credits{plan.refills ? " every month" : ", one-time"}
            </p>

            <ul className="mt-sm sm:mt-md flex flex-col gap-xs sm:gap-sm flex-1">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-xs sm:gap-sm text-body-sm text-on-surface leading-snug">
                  <Check size={14} weight="bold" className="text-success-accent shrink-0 mt-[2px]" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => !isCurrent && onChoosePlan(plan.id)}
              disabled={isCurrent}
              className={`mt-md sm:mt-lg py-sm sm:py-md rounded-xl text-label-md font-semibold transition-colors ${
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
