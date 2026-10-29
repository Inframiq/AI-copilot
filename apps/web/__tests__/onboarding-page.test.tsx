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
import type { Plan } from "@career-copilot/types";

const CATALOG: { plans: Plan[] } = {
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
  await screen.findByText("Welcome to KripaX");
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
    await user.click(await screen.findByRole("button", { name: "Continue with Free" }));
    expect(pushMock).toHaveBeenCalledWith("/dashboard?tour=1");
  });

  it("opens the upgrade modal for 'Upgrade to Premium', then finishes on 'OK'", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await advanceToPlanStep(user);

    await user.click(await screen.findByRole("button", { name: "Upgrade to Premium" }));
    await user.click(await screen.findByRole("button", { name: /^ok$/i }));
    expect(pushMock).toHaveBeenCalledWith("/dashboard?tour=1");
  });
});

describe("Onboarding — details step", () => {
  it("goes on without a phone number, and saves none", async () => {
    const { upsertCareerProfile } = await import("../lib/career-profile-client");
    vi.mocked(upsertCareerProfile).mockClear();
    const user = userEvent.setup();
    renderOnboarding();
    await screen.findByDisplayValue("Jane");
    await user.selectOptions(screen.getByRole("combobox"), "working");
    const next = screen.getByRole("button", { name: /^continue$/i });
    expect(next).toBeEnabled();
    await user.click(next);
    await screen.findByText("Upload your resume");
    const saved = vi.mocked(upsertCareerProfile).mock.calls[0][0] as unknown as { contact: Record<string, string> };
    expect("phone" in saved.contact).toBe(false);
  });
});

describe("Onboarding — a résumé never replaces the details from step 1", () => {
  it("keeps the typed name, sign-in email, phone and role when a résumé is dropped", async () => {
    const { upsertCareerProfile, resumeContentToCareerProfileInput } = await import("../lib/career-profile-client");
    vi.mocked(upsertCareerProfile).mockClear();
    vi.mocked(apiClient.parseResumeFile).mockResolvedValue({ id: "r1", content: {} } as never);
    vi.mocked(resumeContentToCareerProfileInput).mockReturnValue({
      contact: { name: "J. Smith", email: "old@work.com", phone: "555-0100", linkedin: "linkedin.com/in/jane" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
    } as never);
    const user = userEvent.setup();
    renderOnboarding();
    await screen.findByDisplayValue("Jane");
    // The email is the sign-in email, shown read-only.
    expect((screen.getByDisplayValue("jane@example.com") as HTMLInputElement).readOnly).toBe(true);
    await user.type(screen.getByPlaceholderText("+1 (555) 000-0000"), "+91 98765 43210");
    await user.selectOptions(screen.getByRole("combobox"), "working");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByText("Upload your resume");

    const { fireEvent } = await import("@testing-library/react");
    // The drop zone is the label wrapping the hidden file input.
    const zone = document.querySelector('input[type="file"]')!.closest("label")!;
    const file = new File(["%PDF"], "resume.pdf", { type: "application/pdf" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await vi.waitFor(() => expect(vi.mocked(upsertCareerProfile).mock.calls.length).toBe(2));
    const saved = vi.mocked(upsertCareerProfile).mock.calls[1][0] as unknown as {
      contact: Record<string, string>; role_status: string | null;
    };
    expect(saved.contact).toEqual({
      name: "Jane", email: "jane@example.com", phone: "+91 98765 43210", linkedin: "linkedin.com/in/jane",
    });
    expect(saved.role_status).toBe("working");
  });

  // The database refuses a link that isn't a profile link, and would refuse
  // the whole save over it: such a link stays on the résumé only.
  it("keeps a résumé's LinkedIn off the profile when it isn't a profile link", async () => {
    const { upsertCareerProfile, resumeContentToCareerProfileInput } = await import("../lib/career-profile-client");
    vi.mocked(upsertCareerProfile).mockClear();
    vi.mocked(apiClient.parseResumeFile).mockResolvedValue({ id: "r1", content: {} } as never);
    vi.mocked(resumeContentToCareerProfileInput).mockReturnValue({
      contact: { name: "", email: "", linkedin: "linkedin.com/company/acme", github: "https://github.com/jane/" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
    } as never);
    const user = userEvent.setup();
    renderOnboarding();
    await screen.findByDisplayValue("Jane");
    await user.selectOptions(screen.getByRole("combobox"), "working");
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByText("Upload your resume");
    const { fireEvent } = await import("@testing-library/react");
    const zone = document.querySelector('input[type="file"]')!.closest("label")!;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["%PDF"], "resume.pdf", { type: "application/pdf" })] } });

    await vi.waitFor(() => expect(vi.mocked(upsertCareerProfile).mock.calls.length).toBe(2));
    const saved = vi.mocked(upsertCareerProfile).mock.calls[1][0] as unknown as { contact: Record<string, string> };
    expect(saved.contact.linkedin).toBe("");
    expect(saved.contact.github).toBe("github.com/jane");
  });
});
