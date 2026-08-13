// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pushMock = vi.fn();
const signOutMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({ auth: { signOut: signOutMock } }),
}));

import { Sidebar } from "../../components/layout/Sidebar";

// Sidebar calls useQueryClient() (to clear the cache on sign-out), which
// throws without a provider in the tree.
function renderSidebar() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar />
    </QueryClientProvider>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    pushMock.mockClear();
    signOutMock.mockClear();
  });

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
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
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

  it("signs out and redirects to /login on Sign Out click", async () => {
    renderSidebar();
    await userEvent.click(screen.getByText("Sign Out"));
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
