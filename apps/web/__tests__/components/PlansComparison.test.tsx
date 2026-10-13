// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({ apiClient: { getPlans: vi.fn() } }));

import { PlansComparison } from "../../components/plans/PlansComparison";
import { apiClient } from "../../lib/api-client";
import type { Plan } from "@career-copilot/types";

const CATALOG: { plans: Plan[] } = {
  plans: [
    { id: "free", name: "Free", tagline: "Get started with résumé tailoring.", price_usd: 0, period: null,
      credits: 50, refills: false,
      features: ["Up to 5 résumé tailoring runs", "Job description analysis with an ATS match score",
        "Includes cover letters, interview questions and bullet rewrites"] },
    { id: "premium", name: "Premium", tagline: "For an active, ongoing job search.", price_usd: 5, period: "month",
      credits: 600, refills: true,
      features: ["Everything in Free, plus:", "Up to 60 résumé tailoring runs per month",
        "Credits refresh every 30 days", "Priority support"] },
  ],
};

function renderIt(extra: { currentPlan?: string; onChoosePlan?: (id: string) => void } = {}) {
  const onChoosePlan = extra.onChoosePlan ?? vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlansComparison currentPlan={extra.currentPlan} onChoosePlan={onChoosePlan} />
    </QueryClientProvider>
  );
  return { onChoosePlan };
}

describe("PlansComparison", () => {
  beforeEach(() => vi.mocked(apiClient.getPlans).mockReset());

  it("renders both plans from the catalog", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    renderIt();
    expect(await screen.findByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Premium" })).toBeInTheDocument();
    expect(screen.getByText("$5")).toBeInTheDocument();
    expect(screen.getByText("Priority support")).toBeInTheDocument();
  });

  it("fires onChoosePlan with the plan id", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    const { onChoosePlan } = renderIt();
    await userEvent.click(await screen.findByRole("button", { name: "Upgrade to Premium" }));
    expect(onChoosePlan).toHaveBeenCalledWith("premium");
  });

  it("disables the current plan's button and labels it", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    const { onChoosePlan } = renderIt({ currentPlan: "free" });
    const currentBtn = await screen.findByRole("button", { name: "Current plan" });
    expect(currentBtn).toBeDisabled();
    await userEvent.click(currentBtn);
    expect(onChoosePlan).not.toHaveBeenCalled();
    // premium button is still active
    expect(screen.getByRole("button", { name: "Upgrade to Premium" })).toBeEnabled();
  });

  it("reads like a pricing page: who each plan is for, ceilings, and a lead-in", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    renderIt();
    expect(await screen.findByText("For an active, ongoing job search.")).toBeInTheDocument();
    expect(screen.getByText("50 credits, one-time")).toBeInTheDocument();
    expect(screen.getByText("600 credits per month")).toBeInTheDocument();
    // The lead-in heads the list rather than being ticked off as a feature.
    const leadIn = screen.getByText("Everything in Free, plus:");
    expect(leadIn.querySelector("svg")).toBeNull();
    expect(screen.getByText("Up to 60 résumé tailoring runs per month").closest("li")?.querySelector("svg")).not.toBeNull();
  });
});
