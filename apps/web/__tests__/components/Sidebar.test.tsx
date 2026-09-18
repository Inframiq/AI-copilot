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

const SUB = {
  plan: "free",
  status: "active",
  credits_remaining: 34,
  credits_allotment: 50,
  current_period_end: null,
  renews: false,
  costs: { tailor: 10, cover_letter: 3, rewrite_bullet: 1, analyze: 0 },
};

import { Sidebar } from "../../components/layout/Sidebar";
import { apiClient } from "../../lib/api-client";

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
    vi.mocked(apiClient.getSubscription).mockImplementation(() => new Promise(() => {}));
  });

  it("shows nav labels when expanded", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(screen.getByText("JD Analyzer")).toBeTruthy();
  });

  it("collapses nav labels to zero width rather than unmounting them", () => {
    // Unmounting made the text vanish instantly while the container took
    // 300ms to narrow — the "pop" behind the reported flicker. Keeping the
    // label mounted lets width and opacity animate with the sidebar.
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    const label = screen.getByText("JD Analyzer");
    expect(label.className).toMatch(/max-w-0/);
    expect(label.className).toMatch(/opacity-0/);
  });

  it("shows nav labels at full width when expanded", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(screen.getByText("JD Analyzer").className).toMatch(/opacity-100/);
  });

  it("never scales nav links, which made the icons appear to resize", () => {
    // The scale was only ever on the ACTIVE link, so this has to check that
    // one — usePathname is mocked to /dashboard.
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(screen.getByLabelText("Dashboard").className).not.toMatch(/scale-/);
  });

  it("animates only specific properties, not transition-all", () => {
    // transition-all animated the padding and gap swap too, dragging the icon
    // across the row on every toggle.
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(screen.getByLabelText("JD Analyzer").className).not.toMatch(/transition-all/);
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
  // The suite's api-client mock keeps getSubscription pending so the meter
  // renders nothing and the nav assertions stay clean. These two resolve it
  // on purpose — asserting "no allotment shown" against an empty meter would
  // pass no matter what variant the sidebar picked.
  it("uses the rail credit meter when collapsed, which is the one that fits", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    await screen.findByText(String(SUB.credits_remaining));
    // The rail form drops the "/ allotment"; compact keeps it and overflows.
    expect(screen.queryByText(/\/\s*50/)).toBeNull();
  });

  it("uses the full credit meter when expanded", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    // Only the full variant names the plan.
    expect(await screen.findByText(/free/i)).toBeTruthy();
  });

  // The control began as a row in the footer, directly beneath eight nav
  // links styled the same way, and was invisible as a result. It is now a
  // flap on the sidebar's outer edge — off the list entirely, where an edge
  // handle is the conventional place to look for one.
  it("keeps the flap out of the scrolling nav so it cannot be clipped", () => {
    // The flap hangs outside the sidebar's border. The nav must scroll on
    // short viewports, and overflow-y:auto computes overflow-x to auto too —
    // so a flap inside the nav would be clipped or add a scrollbar. It lives
    // in a non-scrolling wrapper that shares the nav's top edge instead.
    useSidebarStore.setState({ override: "expanded" });
    const { container } = renderSidebar();
    const flap = screen.getByRole("button", { name: /collapse sidebar/i });
    expect(container.querySelector("nav")!.contains(flap)).toBe(false);
  });

  it("still lets the nav scroll on a short viewport", () => {
    useSidebarStore.setState({ override: "expanded" });
    const { container } = renderSidebar();
    expect(container.querySelector("nav")!.className).toMatch(/overflow-y-auto/);
  });

  it("anchors the flap to the aside, which never scrolls", () => {
    // The aside is position:fixed (already a containing block) and sets no
    // overflow, so the flap can hang past its border without being clipped —
    // no extra wrapper needed.
    useSidebarStore.setState({ override: "expanded" });
    const { container } = renderSidebar();
    const flap = screen.getByRole("button", { name: /collapse sidebar/i });
    expect(flap.parentElement).toBe(container.querySelector("aside"));
  });

  it("hangs the flap outside the sidebar's right border", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    const flap = screen.getByRole("button", { name: /collapse sidebar/i });
    expect(flap.className).toMatch(/absolute/);
    expect(flap.className).toMatch(/translate-x-full/);
  });

  it("centres the flap on the top bar's search pill", () => {
    // TopNav's bar is h-14 (56px), so the pill centres 28px down the viewport.
    // The aside starts at the viewport top, so top-sm (8px) puts this 40px
    // flap's centre on that same line.
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(
      screen.getByRole("button", { name: /collapse sidebar/i }).className,
    ).toMatch(/\btop-sm\b/);
  });

  it("sits near the top rather than centred on the edge", () => {
    // Centred, it landed mid-content on every page. Anchored to the top it
    // sits beside the logo, clear of whatever the page renders below.
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    const flap = screen.getByRole("button", { name: /collapse sidebar/i });
    expect(flap.className).not.toMatch(/top-1\/2/);
    expect(flap.className).not.toMatch(/-translate-y-1\/2/);
    expect(flap.className).toMatch(/top-\w+/);
  });

  it("keeps the flap a small tab, not a slab", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    const flap = screen.getByRole("button", { name: /collapse sidebar/i });
    // h-16 (64px) read as a bar stuck to the side; h-10 is 40px, still a
    // comfortable target but clearly a tab.
    expect(flap.className).toMatch(/\bh-10\b/);
  });

  it("keeps the flap reachable when collapsed", () => {
    useSidebarStore.setState({ override: "collapsed" });
    renderSidebar();
    expect(screen.getByRole("button", { name: /expand sidebar/i }).className).toMatch(/absolute/);
  });

  it("carries no text label, so the rail width never constrains it", () => {
    useSidebarStore.setState({ override: "expanded" });
    renderSidebar();
    expect(
      screen.getByRole("button", { name: /collapse sidebar/i }).textContent,
    ).toBe("");
  });

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
