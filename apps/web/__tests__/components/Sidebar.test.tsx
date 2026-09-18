// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("links the KripaX wordmark back to the dashboard", () => {
    renderSidebar();
    const wordmarkLink = screen.getByAltText("KripaX").closest("a");
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

// ── Collapsible rail ────────────────────────────────────────────────────────
// At md-xl the 280px sidebar squeezes content (the Studio's editor+preview
// pane most of all). It now collapses to a 72px icon rail, with an explicit
// user toggle that overrides the breakpoint rule and persists.
import { useSidebarStore } from "../../stores/sidebar-store";
import { SIDEBAR_OVERRIDE_KEY } from "../../lib/sidebar";

describe("Sidebar collapse", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState({ override: null });
    delete document.documentElement.dataset.sidebar;
  });

  it("shows nav labels when expanded", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(screen.getByText("JD Analyzer")).toBeTruthy();
  });

  it("hides nav labels when collapsed", () => {
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    expect(screen.queryByText("JD Analyzer")).toBeNull();
  });

  it("keeps every nav item reachable by name when collapsed", () => {
    // The icons are the only visible affordance at 72px, so the accessible
    // name has to survive or the rail is unusable with a screen reader.
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    expect(screen.getByLabelText("JD Analyzer")).toBeTruthy();
  });

  it("swaps the wordmark for the compact mark when collapsed", () => {
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    expect(screen.getByAltText("KripaX").getAttribute("src")).toContain("logo-mark");
  });

  it("offers a control to collapse the sidebar", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(screen.getByRole("button", { name: /collapse sidebar/i })).toBeTruthy();
  });

  it("offers a control to expand it again once collapsed", () => {
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    expect(screen.getByRole("button", { name: /expand sidebar/i })).toBeTruthy();
  });

  it("collapses when the control is clicked", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    screen.getByRole("button", { name: /collapse sidebar/i }).click();
    expect(useSidebarStore.getState().override).toBe("collapsed");
  });

  it("remembers the choice", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    screen.getByRole("button", { name: /collapse sidebar/i }).click();
    expect(localStorage.getItem(SIDEBAR_OVERRIDE_KEY)).toBe("collapsed");
  });

  // --sidebar-w must resolve for BOTH the aside and <main>, which are
  // siblings — so the override lives on the document element, the one
  // ancestor both share, not inline on the aside.
  it("publishes the override on the document element so <main> can offset by it", () => {
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
  });

  it("publishes an expanded override too", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(document.documentElement.dataset.sidebar).toBe("expanded");
  });

  it("leaves the width to CSS breakpoints when there is no override", () => {
    // No explicit choice: the width comes from the stylesheet alone, so the
    // correct rail paints before React hydrates.
    renderSidebar();
    expect(document.documentElement.dataset.sidebar).toBeUndefined();
  });
});
