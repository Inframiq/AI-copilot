// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({ apiClient: { getSubscription: vi.fn() } }));

import AccountPage from "../app/(app)/account/page";
import { apiClient } from "../lib/api-client";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountPage />
    </QueryClientProvider>
  );
}

describe("Account page", () => {
  beforeEach(() => vi.mocked(apiClient.getSubscription).mockReset());

  it("shows plan, balance, tailors-left estimate and the cost table", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "free",
      status: "active",
      credits_remaining: 34,
      credits_allotment: 50,
      current_period_end: null,
      renews: false,
      costs: { tailor: 10, cover_letter: 3, rewrite_bullet: 1, analyze: 0 },
    });
    renderPage();

    expect(await screen.findByText(/free plan/i)).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText(/about 3 more resume tailors/i)).toBeInTheDocument();
    expect(screen.getByText("Tailor a resume to a job description")).toBeInTheDocument();
    expect(screen.getByText("10 credits")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument(); // analyze
    expect(screen.getByText(/does not refill/i)).toBeInTheDocument();
  });

  it("warns when the balance is below one tailor", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "free",
      status: "active",
      credits_remaining: 6,
      credits_allotment: 50,
      current_period_end: null,
      renews: false,
      costs: { tailor: 10, analyze: 0 },
    });
    renderPage();
    expect(await screen.findByText(/not enough for another resume tailor/i)).toBeInTheDocument();
  });
});
