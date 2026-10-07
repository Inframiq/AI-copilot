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
import { getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";

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

  // Profile Health is how complete My Profile is (ten checks, 10% each).
  // "Needs work" / "Good" / "Excellent" didn't say that, and "Good" at 50%
  // overstated it.
  describe("Profile Health wording", () => {
    // `filled` of the ten checks pass; name is always one of them.
    function profileWith(filled: number): CareerProfile {
      const has = (i: number) => i < filled;
      return {
        contact: {
          name: "Jane Doe",
          email: has(1) ? "jane@example.com" : "",
          phone: has(2) ? "+91 90000 00000" : "",
          location: has(3) ? "Bengaluru" : "",
          linkedin: has(4) ? "linkedin.com/in/jane" : "",
          github: has(5) ? "github.com/jane" : "",
        },
        headline: has(6) ? "Backend engineer" : "",
        experience: has(7) ? [{ title: "Engineer", company: "Acme", bullets: [] }] : [],
        education: has(8) ? [{ school: "IIT", degree: "B.Tech" }] : [],
        skills: has(9) ? ["a", "b", "c", "d", "e"] : [],
      } as unknown as CareerProfile;
    }

    it.each([
      [3, "30%", "Finish your profile"],
      [6, "60%", "Partly filled in"],
      [8, "80%", "Almost complete"],
      [10, "100%", "Complete"],
    ])("%i of 10 filled reads %s, %s", async (filled, pct, label) => {
      vi.mocked(getCareerProfile).mockResolvedValueOnce(profileWith(filled));
      renderPage();
      const card = await screen.findByRole("button", { name: new RegExp(`Profile Health.*${pct}`) });
      expect(card).toHaveTextContent(label);
      expect(card).not.toHaveTextContent(/needs work|excellent/i);
    });
  });
});
