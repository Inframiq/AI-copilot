// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  usePathname: () => "/jd",
  useRouter: () => ({ push: vi.fn() }),
}));

// TopNav renders <CreditMeter/>, which fetches the subscription. Keep it
// pending so the meter renders nothing and the nav assertions stay clean.
vi.mock("@/lib/api-client", () => ({
  apiClient: { getSubscription: vi.fn(() => new Promise(() => {})) },
}));

// The avatar reads the career profile; pending, it shows its placeholder.
const getCareerProfile = vi.fn(() => new Promise(() => {}));
vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile: () => getCareerProfile() }));

import { TopNav } from "../../components/layout/TopNav";
import { apiClient } from "../../lib/api-client";

function renderTopNav() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TopNav />
    </QueryClientProvider>
  );
}

describe("TopNav", () => {
  it("renders the search box and mobile nav items", () => {
    renderTopNav();
    expect(screen.getByRole("combobox", { name: /Search your résumés, jobs and pages/ })).toBeInTheDocument();
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

  it("keeps My Profile and Account off the tabs and More, behind the avatar", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValueOnce({
      plan: "free", status: "active", credits_remaining: 34, credits_allotment: 50,
      current_period_end: null, renews: false, costs: { tailor: 10 },
    });
    getCareerProfile.mockResolvedValueOnce(null);
    renderTopNav();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const tabs = screen.getByRole("navigation", { name: "Main" });
    const sheet = screen.getByRole("dialog", { name: "More pages" });
    for (const href of ["/profile", "/account"]) {
      expect(tabs.querySelector(`a[href="${href}"]`)).toBeNull();
      expect(sheet.querySelector(`a[href="${href}"]`)).toBeNull();
    }
    const avatar = screen.getByRole("button", { name: /account menu/i });
    await waitFor(() => expect(avatar).toBeEnabled());
    fireEvent.click(avatar);
    expect(screen.getByRole("menuitem", { name: "My Profile" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "/account");
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
