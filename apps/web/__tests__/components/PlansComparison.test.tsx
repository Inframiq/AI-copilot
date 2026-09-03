// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({ apiClient: { getPlans: vi.fn() } }));

import { PlansComparison } from "../../components/plans/PlansComparison";
import { apiClient } from "../../lib/api-client";

const CATALOG = {
  plans: [
    { id: "free", name: "Free", price_usd: 0, period: null, credits: 50, refills: false,
      features: ["50 credits, one-time", "About 5 resume tailors", "Cover letters and bullet rewrites", "Free JD analysis"] },
    { id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true,
      features: ["600 credits every month", "About 60 resume tailors", "Everything in Free", "Priority support"] },
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
    await userEvent.click(await screen.findByRole("button", { name: "Get Premium" }));
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
    expect(screen.getByRole("button", { name: "Get Premium" })).toBeEnabled();
  });
});
