// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getResumes: vi.fn().mockResolvedValue([]),
    getJds: vi.fn().mockResolvedValue([]),
    getLearningItems: vi.fn().mockResolvedValue([]),
    getMyQuestions: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("@/lib/career-profile-client", () => ({
  getCareerProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

import DashboardPage from "../app/(app)/dashboard/page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardPage />
    </QueryClientProvider>
  );
}

describe("Dashboard page", () => {
  beforeEach(() => push.mockClear());

  // A metric card used to be a <button> holding the InfoTooltip's <button>.
  // The browser's HTML parser won't nest buttons, so the server-rendered page
  // came apart, hydration failed, and a stray copy of the dashboard sat on top
  // of the real one.
  it("never nests a button inside a button", () => {
    const { container } = renderPage();
    expect(container.querySelectorAll("button button")).toHaveLength(0);
  });

  it("opens a metric card's page from the keyboard", async () => {
    renderPage();
    const card = screen.getByRole("button", { name: /Profile Health/ });
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/profile");
  });

  it("does not open the card when its info icon is used", async () => {
    renderPage();
    const [info] = screen.getAllByRole("button", { name: "More info" });
    await userEvent.click(info);
    info.focus();
    await userEvent.keyboard("{Enter}");
    expect(push).not.toHaveBeenCalled();
  });
});
