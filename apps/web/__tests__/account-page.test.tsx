// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pushMock = vi.fn();
const signOutMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/api-client", () => ({ apiClient: { getSubscription: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({ auth: { signOut: signOutMock } }),
}));
vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile: vi.fn() }));

import AccountPage from "../app/(app)/account/page";
import { apiClient } from "../lib/api-client";
import { getCareerProfile } from "../lib/career-profile-client";

const SUB = {
  plan: "free",
  status: "active",
  credits_remaining: 34,
  credits_allotment: 50,
  current_period_end: null,
  renews: false,
  costs: { tailor: 10, cover_letter: 3, rewrite_bullet: 1, analyze: 0 },
};

const PROFILE = {
  user_id: "u1",
  contact: { name: "Jordan Ramirez", email: "jordan@example.com", phone: "+1 415 555 0182" },
  role_status: "working",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountPage />
    </QueryClientProvider>
  );
}

describe("Account page", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSubscription).mockReset();
    vi.mocked(getCareerProfile).mockReset();
    pushMock.mockClear();
    signOutMock.mockClear();
  });

  it("shows plan, balance, tailors-left estimate and the cost table", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    vi.mocked(getCareerProfile).mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText(/free plan/i)).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText(/about 3 more resume tailors/i)).toBeInTheDocument();
    expect(screen.getByText("Tailor a resume to a job description")).toBeInTheDocument();
    expect(screen.getByText("10 credits")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument(); // analyze
    expect(screen.getByText(/does not refill/i)).toBeInTheDocument();
  });

  it("warns when the balance is below one tailor", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      ...SUB,
      credits_remaining: 6,
      costs: { tailor: 10, analyze: 0 },
    });
    vi.mocked(getCareerProfile).mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText(/not enough for another resume tailor/i)).toBeInTheDocument();
  });

  it("shows the user's details and an Edit link to My Profile", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    vi.mocked(getCareerProfile).mockResolvedValue(PROFILE as never);
    renderPage();

    expect(await screen.findByText("Jordan Ramirez")).toBeInTheDocument();
    expect(screen.getByText("jordan@example.com")).toBeInTheDocument();
    expect(screen.getByText("+1 415 555 0182")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit in my profile/i })).toHaveAttribute("href", "/profile");
  });

  it("prompts onboarding when there is no profile yet", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    vi.mocked(getCareerProfile).mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText(/finish setting it up/i)).toHaveAttribute("href", "/onboarding");
  });

  it("signs out and redirects to /login", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    vi.mocked(getCareerProfile).mockResolvedValue(null);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("links the upgrade card to /plans", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    vi.mocked(getCareerProfile).mockResolvedValue(null);
    renderPage();
    const link = await screen.findByRole("link", { name: /need more credits/i });
    expect(link).toHaveAttribute("href", "/plans");
  });
});
