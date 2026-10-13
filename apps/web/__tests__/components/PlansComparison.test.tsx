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
      features: ["Includes:", "Résumé tailoring with an ATS match score",
        "Cover letters, interview questions and bullet rewrites",
        "Credits cover up to:", "5 résumé tailoring runs", "16 cover letters", "50 job description analyses"] },
    { id: "premium", name: "Premium", tagline: "For an active, ongoing job search.", price_usd: 5, period: "month",
      credits: 600, refills: true,
      features: ["Everything in Free, plus:", "Credits refresh every 30 days", "Priority support",
        "Monthly credits cover up to:", "60 résumé tailoring runs", "200 cover letters", "600 job description analyses"] },
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

  it("reads like a pricing page: who each plan is for, and labelled sections", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    renderIt();
    expect(await screen.findByText("For an active, ongoing job search.")).toBeInTheDocument();
    expect(screen.getByText("50 credits, one-time")).toBeInTheDocument();
    expect(screen.getByText("600 credits per month")).toBeInTheDocument();
    // Headings head their sections rather than being ticked off as features.
    for (const heading of ["Everything in Free, plus:", "Monthly credits cover up to:", "Credits cover up to:"]) {
      expect(screen.getByText(heading).querySelector("svg")).toBeNull();
    }
    expect(screen.getByText("200 cover letters").closest("li")?.querySelector("svg")).not.toBeNull();
  });

  it("shows only the first section on the compact onboarding cards", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PlansComparison variant="compact" onChoosePlan={vi.fn()} />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Priority support")).toBeInTheDocument();
    expect(screen.queryByText("Monthly credits cover up to:")).toBeNull();
  });
});
