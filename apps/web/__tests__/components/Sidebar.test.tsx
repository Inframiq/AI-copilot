// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// Sidebar renders <CreditMeter/>, which fetches the subscription. Keep it
// pending so the meter renders nothing and the nav assertions stay clean.
vi.mock("@/lib/api-client", () => ({
  apiClient: { getSubscription: vi.fn(() => new Promise(() => {})) },
}));

import { Sidebar } from "../../components/layout/Sidebar";

// CreditMeter calls useQuery(), which needs a provider in the tree.
function renderSidebar() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar />
    </QueryClientProvider>
  );
}

describe("Sidebar", () => {
  it("renders all nav links", () => {
    renderSidebar();
    // Phase 1 nav — Career Path and Networking are intentionally hidden
    // (see components/layout/Sidebar.tsx), not a regression.
    for (const label of [
      "Dashboard",
      "My Profile",
      "JD Analyzer",
      "Resume Builder",
      "Cover Letter",
      "Interview Center",
      "Analytics",
      "Account",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("links the Career Copilot wordmark back to the dashboard", () => {
    renderSidebar();
    const wordmarkLink = screen.getByText("Career Copilot").closest("a");
    expect(wordmarkLink).toHaveAttribute("href", "/dashboard");
  });

  it("marks the current route active", () => {
    renderSidebar();
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).toContain("bg-secondary-container");
  });

  it("does not render dead Settings/Support links", () => {
    renderSidebar();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Support")).not.toBeInTheDocument();
  });

  it("no longer renders a Sign Out button (moved to /account)", () => {
    renderSidebar();
    expect(screen.queryByText(/sign ?out/i)).not.toBeInTheDocument();
  });
});
