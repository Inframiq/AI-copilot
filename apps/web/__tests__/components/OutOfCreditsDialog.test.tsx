// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getSubscription: vi.fn(),
    getPlans: vi.fn(async () => ({
      plans: [
        { id: "free", name: "Free", price_usd: 0, period: null, credits: 50, refills: false, features: [] },
        { id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true, features: [] },
      ],
    })),
  },
}));

import { OutOfCreditsDialog } from "../../components/plans/OutOfCreditsDialog";
import { clearCreditRefusal, reportCreditRefusal, useCreditsStore } from "../../stores/credits-store";
import { apiClient } from "../../lib/api-client";

const REFUSAL = "Out of credits: Tailoring a résumé costs 10 credits and you have 4.";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OutOfCreditsDialog />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  clearCreditRefusal();
  vi.mocked(apiClient.getSubscription).mockResolvedValue({ plan: "free", credits_remaining: 4 } as never);
});

describe("credit refusals", () => {
  it("reads the server's out-of-credits refusal", () => {
    reportCreditRefusal(REFUSAL);
    expect(useCreditsStore.getState().refusal).toEqual({ kind: "credits", action: "Tailoring a résumé", cost: 10, have: 4 });
  });

  it("reads a one-credit action too", () => {
    reportCreditRefusal("Out of credits: A rewrite costs 1 credit and you have 0.");
    expect(useCreditsStore.getState().refusal).toEqual({ kind: "credits", action: "A rewrite", cost: 1, have: 0 });
  });

  it("reads a plan that is no longer active", () => {
    reportCreditRefusal("Your subscription is not active.");
    expect(useCreditsStore.getState().refusal).toEqual({ kind: "inactive" });
  });

  it("leaves any other 402 to the page that asked", () => {
    reportCreditRefusal("Payment required for something else.");
    reportCreditRefusal({ code: "something_else" });
    expect(useCreditsStore.getState().refusal).toBeNull();
  });
});

describe("OutOfCreditsDialog", () => {
  it("shows nothing until a refusal arrives", () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says what was refused and offers Premium to a free account", async () => {
    reportCreditRefusal(REFUSAL);
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Not enough credits for this" });
    expect(dialog).toHaveTextContent("Tailoring a résumé");
    expect(dialog).toHaveTextContent("10 credits");
    expect(dialog).toHaveTextContent("You have 4");
    expect(dialog).toHaveTextContent("Nothing was charged");
    expect(await screen.findByText("Premium · $5 a month")).toBeInTheDocument();
    expect(await screen.findByText(/600 credits every 30 days, instead of a one-time 50/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade to Premium/ })).toHaveAttribute("href", "/plans");
    expect(screen.queryByRole("link", { name: /Renew/ })).toBeNull();
  });

  it("on Premium, offers to renew — with when the credits would come back anyway", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "premium", status: "active", credits_remaining: 4, credits_allotment: 600, renews: true,
      current_period_end: "2026-11-12T00:00:00Z",
    } as never);
    reportCreditRefusal(REFUSAL);
    renderDialog();

    expect(await screen.findByText("Renew Premium · $5 a month")).toBeInTheDocument();
    expect(screen.getByText(/starting a new 30-day period \(otherwise they refill on/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Renew Premium/ })).toHaveAttribute("href", "/plans");
    expect(screen.queryByRole("link", { name: /Upgrade/ })).toBeNull();
  });

  it("when Premium has ended, says so and offers to renew", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "premium", status: "expired", credits_remaining: 0, renews: false, current_period_end: null,
    } as never);
    reportCreditRefusal("Your subscription is not active.");
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Your plan has ended" });
    expect(dialog).toHaveTextContent("Nothing was charged");
    expect(await screen.findByText("Premium has ended")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Renew Premium/ })).toHaveAttribute("href", "/plans");
  });

  it("closes with Not now, the X or Escape", async () => {
    for (const close of [
      () => fireEvent.click(screen.getByRole("button", { name: "Not now" })),
      () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
      () => fireEvent.keyDown(window, { key: "Escape" }),
    ]) {
      reportCreditRefusal(REFUSAL);
      renderDialog();
      await screen.findByRole("dialog");
      close();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(useCreditsStore.getState().refusal).toBeNull();
      cleanup();
    }
  });
});
