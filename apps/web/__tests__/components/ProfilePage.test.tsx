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
      content: { contact: { name: "Jane Parsed" }, skills: ["Python"], awards: ["Spot Award"] },
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
    // Awards fill the profile's own Awards section — no longer Miscellaneous.
    expect(await screen.findByRole("textbox", { name: "Awards 1" })).toHaveValue("Spot Award");
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

describe("My Profile — experience dates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertCareerProfile.mockResolvedValue({});
    getCareerProfile.mockResolvedValue({
      user_id: "u1", master_resume_id: null,
      contact: { name: "Jane", email: "j@x.com" },
      experience: [{
        id: "e1", type: "full-time", company: "Acme", title: "Engineer", location: "",
        start: "Jan 2022", end: "Dec 2023", current: false,
        responsibilities: "", achievements: "", projects: "", impact: "",
      }],
      projects: [], education: [], skills: [], certifications: [],
      headline: null, role_status: null, photo_url: null, photo_path: null,
      created_at: "", updated_at: "",
    });
  });

  it("'I work here now' shows Present, and unticking brings back the typed end date", async () => {
    renderPage();
    const end = (await screen.findByLabelText("End")) as HTMLInputElement;
    expect(end.value).toBe("Dec 2023");

    await userEvent.click(screen.getByRole("checkbox", { name: "I work here now" }));
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("Present");
    expect((screen.getByLabelText("End") as HTMLInputElement).readOnly).toBe(true);

    await userEvent.click(screen.getByRole("checkbox", { name: "I work here now" }));
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("Dec 2023");
  });

  it("saves a ticked role as current", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: "I work here now" }));
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(upsertCareerProfile).toHaveBeenCalledWith(expect.objectContaining({
        experience: [expect.objectContaining({ current: true })],
      })),
    );
  });
});

describe("My Profile — every résumé section", () => {
  const profile = (extra: Record<string, unknown> = {}) => ({
    user_id: "u1", master_resume_id: null,
    contact: { name: "Jane", email: "j@x.com" },
    experience: [], projects: [], education: [], skills: [], certifications: [],
    headline: null, role_status: null, photo_url: null, photo_path: null,
    created_at: "", updated_at: "",
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    upsertCareerProfile.mockResolvedValue({});
  });

  async function save() {
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    return upsertCareerProfile.mock.calls[0][0];
  }

  it("always shows Summary, and offers the rest from Add section with a hint each", async () => {
    getCareerProfile.mockResolvedValue(profile());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Leadership" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /add section/i }));
    const sheet = screen.getByRole("dialog", { name: "Add a section" });
    for (const label of ["Objective", "Languages", "Awards", "Achievements", "Leadership", "Volunteer", "Interests"]) {
      expect(sheet).toHaveTextContent(label);
    }
    expect(sheet).toHaveTextContent("Clubs, class rep, team lead, event organiser.");
  });

  it("adds a section with a line to type in, and saves it", async () => {
    getCareerProfile.mockResolvedValue(profile());
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /add section/i }));
    await userEvent.click(screen.getByRole("button", { name: /Leadership/ }));

    expect(screen.queryByRole("dialog", { name: "Add a section" })).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Leadership 1" }), "President, Coding Club");
    expect((await save()).leadership).toEqual(["President, Coding Club"]);
  });

  it("no longer offers a section that's already on the Profile", async () => {
    getCareerProfile.mockResolvedValue(profile({ interests: ["Chess"] }));
    renderPage();
    expect(await screen.findByRole("textbox", { name: "Interests 1" })).toHaveValue("Chess");
    await userEvent.click(screen.getByRole("button", { name: /add section/i }));
    expect(screen.getByRole("dialog", { name: "Add a section" })).not.toHaveTextContent("Interests");
  });

  it("removing a section clears it on Save", async () => {
    getCareerProfile.mockResolvedValue(profile({ awards: ["Dean's List"], summary: "Engineer." }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Remove Awards section" }));
    expect(screen.queryByRole("heading", { name: "Awards" })).toBeNull();
    const saved = await save();
    expect(saved.awards).toEqual([]);
    expect(saved.summary).toBe("Engineer.");
  });

  it("caps the summary at 80 words", async () => {
    getCareerProfile.mockResolvedValue(profile());
    renderPage();
    await screen.findByRole("heading", { name: "Summary" });
    const summary = document.getElementById("profile-summary") as HTMLTextAreaElement;
    await userEvent.click(summary);
    await userEvent.paste(Array.from({ length: 90 }, (_, i) => `w${i}`).join(" "));
    expect(summary.value.split(" ")).toHaveLength(80);
    expect(screen.getByText("80 / 80 words")).toBeInTheDocument();
  });

  it("isn't counted as unsaved just for loading a profile with sections", async () => {
    getCareerProfile.mockResolvedValue(profile({ summary: "Engineer.", languages: [{ name: "Hindi", level: "" }] }));
    renderPage();
    expect(await screen.findByRole("combobox", { name: "Language 1" })).toHaveValue("Hindi");
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
  });
});

describe("My Profile — LinkedIn and GitHub", () => {
  const profile = (contact: Record<string, string> = {}) => ({
    user_id: "u1", master_resume_id: null,
    contact: { name: "Jane", email: "j@x.com", ...contact },
    experience: [], projects: [], education: [], skills: [], certifications: [],
    headline: null, role_status: null, photo_url: null, photo_path: null,
    created_at: "", updated_at: "",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    upsertCareerProfile.mockResolvedValue({});
  });

  it("puts a profile link in its standard form on leaving the field, and saves that", async () => {
    getCareerProfile.mockResolvedValue(profile());
    renderPage();
    const field = await screen.findByRole("textbox", { name: "LinkedIn profile link" });
    await userEvent.type(field, "https://www.linkedin.com/in/jane-doe/");
    await userEvent.tab();
    expect(field).toHaveValue("linkedin.com/in/jane-doe");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(upsertCareerProfile).toHaveBeenCalledWith(
        expect.objectContaining({ contact: expect.objectContaining({ linkedin: "linkedin.com/in/jane-doe" }) }),
      ),
    );
  });

  it("flags a link that isn't a profile and won't save it", async () => {
    getCareerProfile.mockResolvedValue(profile());
    renderPage();
    const field = await screen.findByRole("textbox", { name: "GitHub profile link" });
    await userEvent.type(field, "github.com/jane/kripax");
    await userEvent.tab();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use your profile link: github.com/your-username")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(await screen.findByText(/Fix the GitHub link before saving/)).toBeInTheDocument();
    expect(upsertCareerProfile).not.toHaveBeenCalled();
  });

  // Saved before the rule: shown as needing a fix, but the rest of the
  // profile still saves (the database allows an unchanged one too).
  it("shows an old untidy link as needing a fix, and still saves other changes", async () => {
    getCareerProfile.mockResolvedValue(profile({ linkedin: "https://www.linkedin.com/company/acme" }));
    renderPage();
    expect(await screen.findByText(/Needs a fix\. Use your profile link: linkedin\.com\/in\/your-name/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("San Francisco, CA"), "Pune");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
  });
});
