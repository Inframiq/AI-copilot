// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: { getPlans: vi.fn(), getSubscription: vi.fn() },
}));

import PlansPage from "../app/(app)/plans/page";
import { apiClient } from "../lib/api-client";

const CATALOG = {
  plans: [
    { id: "free", name: "Free", price_usd: 0, period: null, credits: 50, refills: false, features: ["a", "b", "c", "d"] },
    { id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true, features: ["a", "b", "c", "d"] },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlansPage />
    </QueryClientProvider>
  );
}

describe("Plans page", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "free", status: "active", credits_remaining: 50, credits_allotment: 50,
      current_period_end: null, renews: false, costs: {},
    });
  });

  it("opens the upgrade modal when Get Premium is clicked", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Get Premium" }));
    expect(await screen.findByText(/payments are launching soon/i)).toBeInTheDocument();
  });
});
