// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/jd",
}));

import { TopNav } from "../../components/layout/TopNav";

describe("TopNav", () => {
  it("renders the search input and mobile nav items", () => {
    render(<TopNav />);
    expect(screen.getByPlaceholderText("Search resources...")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Interview")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  it("marks the current mobile nav item active", () => {
    render(<TopNav />);
    const jdLink = screen.getByText("JD").closest("a");
    expect(jdLink?.className).toContain("text-primary");
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).not.toContain("text-primary");
  });
});
