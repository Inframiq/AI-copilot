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

function renderMeter(variant: "compact" | "full" | "rail") {
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

  // "34 / 50" didn't say whether 34 had been used or was left.
  it("says the balance is what's left, out of the allotment (compact)", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("compact");
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/account");
    expect(link).toHaveTextContent("34 of 50 left");
    expect(link).toHaveAttribute("title", "34 of 50 credits left");
    expect(link).toHaveAttribute("aria-label", "34 of 50 credits left");
  });

  it("says the balance is what's left, with the plan and a progress bar (full)", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("full");
    expect(await screen.findByText(/free plan/i)).toBeInTheDocument();
    expect(screen.getByText("Credits left")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveTextContent("34 of 50");
  });

  it("flags a low balance (below the tailor cost)", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({ ...SUB, credits_remaining: 4 });
    renderMeter("compact");
    const link = await screen.findByRole("link");
    await waitFor(() => expect(link.className).toContain("text-error"));
  });
});

// ── rail variant ────────────────────────────────────────────────────────────
// The collapsed sidebar is 72px wide and the aside's own p-md eats 32 of
// that, leaving ~40px of usable width. The compact variant needs roughly
// 100px (px-md padding + icon + "34" + "/ 50" once lg applies), so it spilled
// out of the rail. This variant is what actually fits.

describe("CreditMeter rail variant", () => {
  beforeEach(() => vi.mocked(apiClient.getSubscription).mockReset());

  it("shows the remaining balance", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("rail");
    expect(await screen.findByText("34")).toBeTruthy();
  });

  it("drops the allotment, which is what overflowed the rail", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("rail");
    await screen.findByText("34");
    expect(screen.queryByText(/50/)).toBeNull();
  });

  it("keeps the full balance, and that it's what's left, in its accessible name and tooltip", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("rail");
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("aria-label", "34 of 50 credits left");
    expect(link).toHaveAttribute("title", "34 of 50 credits left");
  });

  it("still links to /account", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    renderMeter("rail");
    expect((await screen.findByRole("link")).getAttribute("href")).toBe("/account");
  });

  it("flags a low balance the same way the other variants do", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({ ...SUB, credits_remaining: 2 });
    renderMeter("rail");
    const link = await screen.findByRole("link");
    expect(link.className).toContain("error");
  });
});
