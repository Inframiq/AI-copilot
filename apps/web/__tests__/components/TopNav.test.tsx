// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("links the KripaX wordmark back to the dashboard", () => {
    renderTopNav();
    const wordmarkLink = screen.getByAltText("KripaX").closest("a");
    expect(wordmarkLink).toHaveAttribute("href", "/dashboard");
  });

  it("reaches every page the sidebar offers: four tabs and the rest under More", async () => {
    const { APP_NAV } = await import("@/lib/nav");
    renderTopNav();
    const tabs = screen.getByRole("navigation", { name: "Main" });
    expect(tabs.querySelectorAll("a")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More pages" });
    const reachable = new Set(
      [...tabs.querySelectorAll("a"), ...sheet.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    );
    for (const item of APP_NAV) expect(reachable).toContain(item.href);
  });

  it("closes the More sheet on Escape", () => {
    renderTopNav();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("dialog", { name: "More pages" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "More pages" })).toBeNull();
  });

  it("marks the current mobile nav item active", () => {
    renderTopNav();
    const jdLink = screen.getByText("JD").closest("a");
    expect(jdLink?.className).toContain("text-primary");
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).not.toContain("text-primary");
  });
});
