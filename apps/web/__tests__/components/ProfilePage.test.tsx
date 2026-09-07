// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/resume/ResumePreviewModal", () => ({ ResumePreviewModal: () => null }));

// vi.hoisted keeps these fn refs available inside the hoisted vi.mock factories
// below without tripping the "cannot access before initialization" TDZ error.
const { getCareerProfile, upsertCareerProfile, uploadProfilePhoto } = vi.hoisted(() => ({
  getCareerProfile: vi.fn(),
  upsertCareerProfile: vi.fn(),
  uploadProfilePhoto: vi.fn(),
}));
vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, getCareerProfile, upsertCareerProfile };
});

vi.mock("@/lib/photo-upload", () => ({ uploadProfilePhoto, uploadResumePhoto: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getResume: vi.fn(),
    parseResumeFile: vi.fn(),
    getOriginalResumeFile: vi.fn(),
  },
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

describe("My Profile — profile photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue({
      user_id: "u1", master_resume_id: null,
      contact: { name: "Jane", email: "j@x.com" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
      headline: null, role_status: null,
      photo_url: null, photo_path: null,
      created_at: "", updated_at: "",
    });
    upsertCareerProfile.mockResolvedValue({});
    uploadProfilePhoto.mockResolvedValue({
      url: "https://sb.example/avatars/u1/profile.png", path: "u1/profile.png",
    });
  });

  it("uploads on file pick and persists photo_url/photo_path on Save", async () => {
    renderPage();
    await screen.findByText("Profile Photo");

    const file = new File(["x"], "me.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/upload photo/i), file);

    await waitFor(() => expect(uploadProfilePhoto).toHaveBeenCalledWith(file));
    await screen.findByText("Replace"); // card now reflects the uploaded photo

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() =>
      expect(upsertCareerProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          photo_url: "https://sb.example/avatars/u1/profile.png",
          photo_path: "u1/profile.png",
        }),
      ),
    );
  });

  it("Remove clears the photo and Save persists nulls", async () => {
    getCareerProfile.mockResolvedValue({
      user_id: "u1", master_resume_id: null,
      contact: { name: "Jane", email: "j@x.com" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
      headline: null, role_status: null,
      photo_url: "https://sb.example/avatars/u1/profile.png", photo_path: "u1/profile.png",
      created_at: "", updated_at: "",
    });
    renderPage();
    await screen.findByText("Profile Photo");
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(upsertCareerProfile).toHaveBeenCalledWith(
        expect.objectContaining({ photo_url: null, photo_path: null }),
      ),
    );
  });
});

describe("My Profile — resume re-parse & unsaved-changes guard", () => {
  const withMasterResume = {
    user_id: "u1", master_resume_id: "r1",
    contact: { name: "Jane", email: "j@x.com" },
    experience: [], projects: [], education: [], skills: [], certifications: [],
    headline: null, role_status: null, photo_url: null, photo_path: null,
    created_at: "", updated_at: "",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    upsertCareerProfile.mockResolvedValue({});
    getCareerProfile.mockResolvedValue(withMasterResume);
    (apiClient.getResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1", title: "Jane's Resume", template_id: "ats_modern", content: {},
    });
  });

  it("Re-parse re-runs extraction on the stored file, in place, without a re-upload", async () => {
    (apiClient.getOriginalResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      signed_url: "https://sb.example/orig.pdf", file_name: "jane.pdf",
    });
    (apiClient.parseResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1", title: "Jane's Resume", template_id: "ats_modern",
      content: { contact: { name: "Jane Parsed" }, skills: ["Python"] },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
    }) as unknown as typeof fetch;

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /re-parse/i }));

    await waitFor(() =>
      // stored template preserved, same row overwritten (resume_id passed)
      expect(apiClient.parseResumeFile).toHaveBeenCalledWith(expect.any(File), "ats_modern", "r1"),
    );
    expect(apiClient.getOriginalResumeFile).toHaveBeenCalledWith("r1");
  });

  it("prompts before leaving once the form has unsaved edits", async () => {
    renderPage();
    const nameInput = await screen.findByPlaceholderText("Jane Smith");

    // Pristine — leaving is not blocked.
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await userEvent.type(nameInput, " Smith");

    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
