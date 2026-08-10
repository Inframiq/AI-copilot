// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

describe("Sidebar", () => {
  beforeEach(() => {
    pushMock.mockClear();
    signOutMock.mockClear();
  });

  it("renders all nav links", () => {
    render(<Sidebar />);
    for (const label of [
      "Dashboard",
      "My Profile",
      "Career Path",
      "JD Analyzer",
      "Resume Builder",
      "Interview Center",
      "Networking",
      "Analytics",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the current route active", () => {
    render(<Sidebar />);
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).toContain("bg-secondary-container");
  });

  it("does not render dead Settings/Support links", () => {
    render(<Sidebar />);
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Support")).not.toBeInTheDocument();
  });

  it("signs out and redirects to /login on Sign Out click", async () => {
    render(<Sidebar />);
    await userEvent.click(screen.getByText("Sign Out"));
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(pushMock).toHaveBeenCalledWith("/login");
  });
});
