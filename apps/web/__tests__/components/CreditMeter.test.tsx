// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSubscription: vi.fn() },
}));

import { CreditMeter } from "../../components/layout/CreditMeter";
import { apiClient } from "../../lib/api-client";

const SUB = {
  plan: "free",
  status: "active",
  credits_remaining: 34,
  credits_allotment: 50,
  current_period_end: null,
  renews: false,
  costs: { tailor: 10, cover_letter: 3, rewrite_bullet: 1, analyze: 0 },
};

function renderMeter(variant: "compact" | "full") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreditMeter variant={variant} />
    </QueryClientProvider>
  );
}

describe("CreditMeter", () => {
  beforeEach(() => vi.mocked(apiClient.getSubscription).mockReset());

  it("renders nothing until the balance has loaded", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    const { container } = renderMeter("compact");
    // Synchronous first paint — the query hasn't resolved yet.
    expect(container).toBeEmptyDOMElement();
    // Let it settle so the test doesn't leave a pending update.
    await screen.findByRole("link");
  });

  it("shows remaining / allotment and links to /account (compact)", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("compact");
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/account");
    expect(link).toHaveTextContent("34");
    expect(link).toHaveTextContent("/ 50");
  });

  it("shows the plan and a progress bar (full)", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("full");
    expect(await screen.findByText(/free plan/i)).toBeInTheDocument();
    expect(screen.getByText("Credits")).toBeInTheDocument();
  });

  it("flags a low balance (below the tailor cost)", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({ ...SUB, credits_remaining: 4 });
    renderMeter("compact");
    const link = await screen.findByRole("link");
    await waitFor(() => expect(link.className).toContain("text-error"));
  });
});
