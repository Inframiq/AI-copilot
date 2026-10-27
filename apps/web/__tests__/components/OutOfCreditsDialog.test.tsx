// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getSubscription: vi.fn(),
    getPlans: vi.fn(async () => ({
      plans: [{ id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true, features: [] }],
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
    expect(useCreditsStore.getState().refusal).toEqual({ action: "Tailoring a résumé", cost: 10, have: 4 });
  });

  it("reads a one-credit action too", () => {
    reportCreditRefusal("Out of credits: A rewrite costs 1 credit and you have 0.");
    expect(useCreditsStore.getState().refusal).toEqual({ action: "A rewrite", cost: 1, have: 0 });
  });

  it("leaves any other 402 to the page that asked", () => {
    reportCreditRefusal("Your subscription is not active.");
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
    expect(screen.getByRole("link", { name: /See Premium/ })).toHaveAttribute("href", "/plans");
  });

  it("on a paid plan, says when the credits come back instead of upselling", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "premium", credits_remaining: 4, credits_allotment: 600, renews: true,
      current_period_end: "2026-11-12T00:00:00Z",
    } as never);
    reportCreditRefusal(REFUSAL);
    renderDialog();

    expect(await screen.findByText(/Your 600 credits refill on/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /See Premium/ })).toBeNull();
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
