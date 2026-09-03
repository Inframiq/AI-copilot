// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { email: "jane@example.com", user_metadata: { full_name: "Jane" } } },
        }),
    },
  }),
}));
vi.mock("@/lib/career-profile-client", () => ({
  upsertCareerProfile: vi.fn().mockResolvedValue({}),
  setProfileMasterResume: vi.fn(),
  resumeContentToCareerProfileInput: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: { getPlans: vi.fn(), parseResumeFile: vi.fn() },
}));

import OnboardingPage from "../app/(app)/onboarding/page";
import { apiClient } from "../lib/api-client";

const CATALOG = {
  plans: [
    { id: "free", name: "Free", price_usd: 0, period: null, credits: 50, refills: false, features: ["a", "b", "c", "d"] },
    { id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true, features: ["a", "b", "c", "d"] },
  ],
};

function renderOnboarding() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OnboardingPage />
    </QueryClientProvider>
  );
}

async function advanceToPlanStep(user: ReturnType<typeof userEvent.setup>) {
  // Step 1 — details. Name/email prefill from the mocked getUser (async effect).
  await screen.findByText("Welcome to Career Copilot");
  await screen.findByDisplayValue("Jane"); // wait for the prefill effect to land
  await user.type(screen.getByPlaceholderText("+1 (555) 000-0000"), "5551234567");
  await user.selectOptions(screen.getByRole("combobox"), "working");
  await user.click(screen.getByRole("button", { name: /^continue$/i }));
  // Step 2 — résumé. Skip.
  await screen.findByText("Upload your resume");
  await user.click(screen.getByRole("button", { name: /skip for now/i }));
}

describe("Onboarding — plan step", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
  });

  it("shows the plan cards after the résumé step and finishes on 'Continue on Free'", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await advanceToPlanStep(user);

    expect(await screen.findByText("Choose your plan")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Continue on Free" }));
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  it("opens the upgrade modal for 'Get Premium', then finishes on 'Got it'", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await advanceToPlanStep(user);

    await user.click(await screen.findByRole("button", { name: "Get Premium" }));
    await user.click(await screen.findByRole("button", { name: /got it/i }));
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });
});
