// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    getSubscription: vi.fn().mockResolvedValue({ plan: "free", credits_remaining: 34, credits_allotment: 50, costs: {} }),
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
import { apiClient } from "@/lib/api-client";

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

  // Profile Health is how complete My Profile is, part by part
  // (lib/profile-health; its own tests cover the scoring). The card shows
  // the step that adds the most, so it says what to do next.
  describe("Profile Health", () => {
    it("shows the score and the next step", async () => {
      vi.mocked(getCareerProfile).mockResolvedValueOnce({
        contact: { name: "Jane Doe", email: "jane@example.com" },
        experience: [{ title: "Accountant", company: "Acme", start: "Jan 2020", end: "", current: true,
                       responsibilities: "", achievements: "", impact: "" }],
      } as unknown as CareerProfile);
      renderPage();
      const card = await screen.findByRole("button", { name: /Profile Health.*8%/ });
      expect(card).toHaveTextContent("Add points to 1 job");
    });

    it("says Complete when every part is filled in", async () => {
      vi.mocked(getCareerProfile).mockResolvedValueOnce({
        role_status: "working",
        contact: { name: "Jane Doe", email: "jane@example.com", phone: "+91 90000 00000", location: "Pune",
                   linkedin: "linkedin.com/in/jane" },
        headline: "Accountant",
        summary: "Accountant with six years of monthly closes.",
        experience: [{ title: "Accountant", company: "Acme", start: "Jan 2020", end: "", current: true,
                       responsibilities: "• Closed the books", achievements: "", impact: "" }],
        education: [{ institution: "Pune University", degree: "B.Com", year: "2017" }],
        skills: ["a", "b", "c", "d", "e", "f"],
      } as unknown as CareerProfile);
      renderPage();
      const card = await screen.findByRole("button", { name: /Profile Health.*100%/ });
      expect(card).toHaveTextContent("Complete");
    });
  });

  // Each part used to draw itself when its own request came back: "No
  // resumes yet" and zeros first, then the name, the numbers and the résumés
  // over the next two seconds. Now nothing shows a value until all of it can.
  it("shows placeholders, never interim values, until every part has loaded", async () => {
    let finish!: (v: unknown) => void;
    vi.mocked(apiClient.getResumes).mockReturnValueOnce(new Promise((r) => (finish = r)) as never);
    vi.mocked(getCareerProfile).mockResolvedValueOnce({
      contact: { name: "Jane Doe", email: "jane@example.com" },
    } as unknown as CareerProfile);
    const { container } = renderPage();
    await waitFor(() => expect(apiClient.getJds).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    // Everything else is in; the résumés aren't.
    expect(screen.queryByText("No resumes yet")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByRole("button", { name: /Profile Health/ })).not.toHaveTextContent("%");
    finish([{ id: "r1", title: "Backend CV", updated_at: "2026-10-01T00:00:00Z", ats_score: null }]);
    expect(await screen.findByText("Backend CV")).toBeInTheDocument();
    expect(container.querySelector("h1")).toHaveTextContent("Jane");
    // Name and email: 8 of the 100 points.
    expect(screen.getByRole("button", { name: /Profile Health/ })).toHaveTextContent("8%");
  });
});
