// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/resume/ResumePreviewModal", () => ({ ResumePreviewModal: () => null }));
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { email: "jane@account.com" } } }),
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
    },
  }),
}));

const { getCareerProfile, upsertCareerProfile } = vi.hoisted(() => ({
  getCareerProfile: vi.fn(),
  upsertCareerProfile: vi.fn(),
}));
vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, getCareerProfile, upsertCareerProfile };
});
vi.mock("@/lib/photo-upload", () => ({ uploadProfilePhoto: vi.fn(), uploadResumePhoto: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  apiClient: { getResume: vi.fn(), readResumeFile: vi.fn(), getOriginalResumeFile: vi.fn() },
  ApiError: class ApiError extends Error { status = 0; },
}));

import ProfilePage from "../../app/(app)/profile/page";
import { apiClient } from "@/lib/api-client";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

describe("My Profile — contact information is fixed against résumé uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue({
      user_id: "u1", master_resume_id: null,
      contact: { name: "Jane Smith", email: "jane@account.com", phone: "+91 98765 43210" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
      headline: null, role_status: null, photo_url: null, photo_path: null,
      created_at: "", updated_at: "",
    });
    upsertCareerProfile.mockResolvedValue({});
    vi.mocked(apiClient.getResume).mockResolvedValue({ id: "r1", title: "Résumé", template_id: "ats_clean", content: {} } as never);
  });

  it("shows the sign-in email read-only", async () => {
    renderPage();
    const email = (await screen.findByLabelText(/Email Address/)) as HTMLInputElement;
    await waitFor(() => expect(email.value).toBe("jane@account.com"));
    expect(email.readOnly).toBe(true);
    expect(email).toHaveAccessibleDescription("The sign-in email for this account. It cannot be changed.");
  });

  it("shows the saved name read-only and saves it, whatever the form held", async () => {
    renderPage();
    const name = (await screen.findByLabelText(/Full Name/)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Jane Smith"));
    expect(name.readOnly).toBe(true);
    expect(name).toHaveAccessibleDescription("Set when the profile was created. It cannot be changed.");
    await userEvent.type(name, "x");
    expect(name.value).toBe("Jane Smith");
    await userEvent.type(screen.getByPlaceholderText("Senior Software Engineer · Open to Work"), "Engineer");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    expect(upsertCareerProfile.mock.calls[0][0].contact).toMatchObject({ name: "Jane Smith", email: "jane@account.com" });
  });

  it("lets a profile with no name yet take one, then fixes it", async () => {
    getCareerProfile.mockResolvedValueOnce({
      user_id: "u1", master_resume_id: null, contact: { name: "", email: "jane@account.com" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
      headline: null, role_status: null, photo_url: null, photo_path: null, created_at: "", updated_at: "",
    });
    renderPage();
    const name = (await screen.findByLabelText(/Full Name/)) as HTMLInputElement;
    expect(name.readOnly).toBe(false);
    expect(name).toHaveAccessibleDescription("Cannot be changed after saving.");
    await userEvent.type(name, "Jane Smith");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    expect(upsertCareerProfile.mock.calls[0][0].contact.name).toBe("Jane Smith");
    await waitFor(() => expect((screen.getByLabelText(/Full Name/) as HTMLInputElement).readOnly).toBe(true));
  });

  it("keeps the user's contact details when a résumé is uploaded, filling only empty fields", async () => {
    vi.mocked(apiClient.readResumeFile).mockResolvedValue({
      title: "Résumé", unplaced: [],
      content: {
        contact: { name: "J. Smith", email: "old@work.com", phone: "555-0100", linkedin: "linkedin.com/in/jane" },
        experience: [], education: [], skills: [],
      },
    } as never);
    const { container } = renderPage();
    await screen.findByDisplayValue("Jane Smith");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["%PDF"], "resume.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(apiClient.readResumeFile).toHaveBeenCalled());
    expect(await screen.findByDisplayValue("linkedin.com/in/jane")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jane Smith")).toBeInTheDocument();
    expect(screen.getByDisplayValue("+91 98765 43210")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("J. Smith")).toBeNull();
    expect(screen.queryByDisplayValue("555-0100")).toBeNull();
    expect((screen.getByLabelText(/Email Address/) as HTMLInputElement).value).toBe("jane@account.com");
  });
});
