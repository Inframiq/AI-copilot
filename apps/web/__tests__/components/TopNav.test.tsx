// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  usePathname: () => "/jd",
}));

// TopNav renders <CreditMeter/>, which fetches the subscription. Keep it
// pending so the meter renders nothing and the nav assertions stay clean.
vi.mock("@/lib/api-client", () => ({
  apiClient: { getSubscription: vi.fn(() => new Promise(() => {})) },
}));

import { TopNav } from "../../components/layout/TopNav";

function renderTopNav() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TopNav />
    </QueryClientProvider>
  );
}

describe("TopNav", () => {
  it("renders the search input and mobile nav items", () => {
    renderTopNav();
    expect(screen.getByPlaceholderText("Search resources...")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Interview")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("links the Career Copilot wordmark back to the dashboard", () => {
    renderTopNav();
    const wordmarkLink = screen.getByText("Career Copilot").closest("a");
    expect(wordmarkLink).toHaveAttribute("href", "/dashboard");
  });

  it("marks the current mobile nav item active", () => {
    renderTopNav();
    const jdLink = screen.getByText("JD").closest("a");
    expect(jdLink?.className).toContain("text-primary");
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).not.toContain("text-primary");
  });
});
