// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/resume/ResumePreviewModal", () => ({ ResumePreviewModal: () => null }));

// vi.hoisted keeps these fn refs available inside the hoisted vi.mock factories
// below without tripping the "cannot access before initialization" TDZ error.
const { getCareerProfile, upsertCareerProfile, uploadProfilePhoto, fileUnplacedPoints } = vi.hoisted(() => ({
  getCareerProfile: vi.fn(),
  upsertCareerProfile: vi.fn(),
  uploadProfilePhoto: vi.fn(),
  fileUnplacedPoints: vi.fn(),
}));
vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, getCareerProfile, upsertCareerProfile, fileUnplacedPoints };
});

vi.mock("@/lib/photo-upload", () => ({ uploadProfilePhoto, uploadResumePhoto: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getResume: vi.fn(),
    readResumeFile: vi.fn(),
    saveUploadedResume: vi.fn(),
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
    (apiClient.saveUploadedResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1", title: "Jane Parsed's Resume", template_id: "ats_modern", content: {},
    });
    fileUnplacedPoints.mockResolvedValue(null);
  });

  it("Re-parse re-runs extraction on the stored file, in place, without a re-upload", async () => {
    (apiClient.getOriginalResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      signed_url: "https://sb.example/orig.pdf", file_name: "jane.pdf",
    });
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", unplaced: [],
      content: {
        contact: { name: "Jane Parsed" }, skills: ["Python"], awards: ["Spot Award"],
        education: [{ institution: "GITAM", degree: "B.Tech", year: "2019", gpa: "8.6/10", honors: "Dean's List" }],
      },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
    }) as unknown as typeof fetch;

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /re-parse/i }));

    await waitFor(() =>
      // read for the same row (resume_id passed); stored only with Save
      expect(apiClient.readResumeFile).toHaveBeenCalledWith(expect.any(File), "r1"),
    );
    expect(apiClient.getOriginalResumeFile).toHaveBeenCalledWith("r1");
    // Awards fill the profile's own Awards section — no longer Miscellaneous.
    expect(await screen.findByRole("textbox", { name: "Awards 1" })).toHaveValue("Spot Award");
    // An education's grade and honors come across with it.
    expect(screen.getByPlaceholderText("e.g. 3.8/4.0 or 8.5/10")).toHaveValue("8.6/10");
    expect(screen.getByPlaceholderText(/Magna Cum Laude/)).toHaveValue("Dean's List");
  });

  it("stores a Replace only with Save Profile; leaving unsaved keeps the old résumé", async () => {
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane Parsed's Resume",
      content: { contact: { name: "Jane" }, skills: ["Python"], education: [] },
      unplaced: [],
    });
    renderPage();
    await screen.findByText("Jane's Resume");
    const file = new File(["%PDF"], "new.pdf", { type: "application/pdf" });
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"][accept=".pdf"]')!, file);

    // Read into the form and shown as not saved; nothing stored.
    expect(await screen.findByText("Not saved · saved with Save Profile")).toBeInTheDocument();
    expect(screen.getByText("Jane Parsed's Resume")).toBeInTheDocument();
    expect(apiClient.readResumeFile).toHaveBeenCalledWith(file, "r1");
    expect(apiClient.saveUploadedResume).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /re-parse/i })).toBeNull();
    // Leaving now asks first.
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    expect(apiClient.saveUploadedResume).toHaveBeenCalledWith(
      file, expect.objectContaining({ skills: ["Python"] }), "ats_clean", "r1",
    );
    expect(upsertCareerProfile.mock.calls[0][0].master_resume_id).toBe("r1");
    expect(await screen.findByText("Jane Parsed's Resume")).toBeInTheDocument();
    expect(screen.queryByText("Not saved · saved with Save Profile")).toBeNull();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("saves a first upload as a new résumé, and the profile points at it", async () => {
    getCareerProfile.mockResolvedValue({ ...withMasterResume, master_resume_id: null });
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", content: { contact: { name: "Jane" }, skills: [], education: [] }, unplaced: [],
    });
    (apiClient.saveUploadedResume as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "new1", title: "Jane's Resume", template_id: "ats_clean", content: {},
    });
    renderPage();
    await screen.findByText(/drag & drop your new resume here/i);
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"][accept=".pdf"]')!, file);
    await screen.findByText("Not saved · saved with Save Profile");
    expect(apiClient.readResumeFile).toHaveBeenCalledWith(file, undefined);

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    expect(apiClient.saveUploadedResume).toHaveBeenCalledWith(file, expect.any(Object), "ats_clean", undefined);
    expect(upsertCareerProfile.mock.calls[0][0].master_resume_id).toBe("new1");
  });

  it("removes the previous résumé's Miscellaneous points on save unless kept; notes stay", async () => {
    fileUnplacedPoints.mockResolvedValue(null);
    getCareerProfile.mockResolvedValue({
      ...withMasterResume,
      miscellaneous: [
        { id: "old1", text: "Old duty one.", section: "miscellaneous", heading: "Key Responsibilities", created_at: "" },
        { id: "old2", text: "Old duty two.", section: "miscellaneous", heading: "Key Responsibilities", created_at: "" },
        { id: "mine", text: "My own note.", section: "miscellaneous", created_at: "" },
      ],
    });
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", content: { contact: { name: "Jane" }, skills: [], education: [] },
      unplaced: [{ heading: "Roles and Responsibilities", points: ["New duty."] }],
    });
    renderPage();
    await screen.findByText("Jane's Resume");
    expect(screen.queryByRole("region", { name: "Points from the new résumé" })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove on save/i })).toBeNull();
    await userEvent.upload(
      document.querySelector<HTMLInputElement>('input[type="file"][accept=".pdf"]')!,
      new File(["%PDF"], "new.pdf", { type: "application/pdf" }),
    );

    const notice = await screen.findByRole("region", { name: "Points from the new résumé" });
    expect(notice).toHaveTextContent("The previous résumé's points are removed then, unless kept. Your own notes stay.");
    expect(notice).toHaveTextContent("Added on saveNew duty. · Roles and Responsibilities");
    // The previous résumé's points are marked to go; a typed note isn't marked at all.
    expect(screen.getAllByText("Removed on save")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Keep: My own note." })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Keep: Old duty two." }));
    expect(screen.getAllByText("Removed on save")).toHaveLength(1);
    expect(screen.getByText("Previous résumé · kept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove on save: Old duty two." })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(fileUnplacedPoints).toHaveBeenCalled());
    expect(fileUnplacedPoints).toHaveBeenCalledWith(
      [{ heading: "Roles and Responsibilities", points: ["New duty."] }], { replace: true, keep: ["old2"] },
    );
  });

  it("keeps all of the previous résumé's points with one button", async () => {
    fileUnplacedPoints.mockResolvedValue(null);
    getCareerProfile.mockResolvedValue({
      ...withMasterResume,
      miscellaneous: [
        { id: "old1", text: "Old duty one.", section: "miscellaneous", heading: "Key Responsibilities", created_at: "" },
        { id: "old2", text: "Old duty two.", section: "miscellaneous", heading: "Key Responsibilities", created_at: "" },
      ],
    });
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", content: { contact: { name: "Jane" }, skills: [], education: [] }, unplaced: [],
    });
    renderPage();
    await screen.findByText("Jane's Resume");
    await userEvent.upload(
      document.querySelector<HTMLInputElement>('input[type="file"][accept=".pdf"]')!,
      new File(["%PDF"], "new.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Keep all from the previous résumé" }));
    expect(screen.queryByText("Removed on save")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove all from the previous résumé on save" }));
    expect(screen.getAllByText("Removed on save")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Keep all from the previous résumé" }));

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(fileUnplacedPoints).toHaveBeenCalledWith([], { replace: true, keep: ["old1", "old2"] }));
  });

  it("doesn't save the profile when the résumé couldn't be saved", async () => {
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", content: { contact: { name: "Jane" }, skills: [], education: [] }, unplaced: [],
    });
    (apiClient.saveUploadedResume as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Couldn't save the résumé"));
    renderPage();
    await screen.findByText("Jane's Resume");
    await userEvent.upload(
      document.querySelector<HTMLInputElement>('input[type="file"][accept=".pdf"]')!,
      new File(["%PDF"], "new.pdf", { type: "application/pdf" }),
    );
    await screen.findByText("Not saved · saved with Save Profile");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the résumé");
    expect(upsertCareerProfile).not.toHaveBeenCalled();
    expect(screen.getByText("Not saved · saved with Save Profile")).toBeInTheDocument();
  });

  it("offers the résumé's different contact details instead of applying them, never the email", async () => {
    getCareerProfile.mockResolvedValue({
      ...withMasterResume, contact: { name: "Jane", email: "j@x.com", phone: "+91 98765 43210" },
    });
    (apiClient.getOriginalResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      signed_url: "https://sb.example/orig.pdf", file_name: "jane.pdf",
    });
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", unplaced: [],
      content: {
        // Same phone written another way; a different name; an old email.
        contact: { name: "Jane Smith", email: "old@work.com", phone: "9876543210", location: "Pune" },
        skills: [], education: [],
      },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
    }) as unknown as typeof fetch;

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /re-parse/i }));
    const offers = await screen.findByRole("region", { name: "Details from the uploaded résumé" });
    // The name differs, so it's offered; the phone is the same number; the
    // empty location just fills; the email is never offered.
    // Each beside the profile's own, to compare without scrolling.
    expect(offers).toHaveTextContent("Full nameProfileJaneRésuméJane Smith");
    expect(offers).not.toHaveTextContent("98765");
    expect(offers).not.toHaveTextContent("old@work.com");
    expect(screen.getByPlaceholderText("Jane Smith")).toHaveValue("Jane");

    await userEvent.click(screen.getByRole("button", { name: "Use Jane Smith as Full name" }));
    expect(screen.getByPlaceholderText("Jane Smith")).toHaveValue("Jane Smith");
    expect(screen.queryByRole("region", { name: "Details from the uploaded résumé" })).toBeNull();
  });

  it("takes every offered detail at once with Use all", async () => {
    getCareerProfile.mockResolvedValue({
      ...withMasterResume, contact: { name: "Jane", email: "j@x.com", phone: "+91 98765 43210" },
    });
    (apiClient.getOriginalResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      signed_url: "https://sb.example/orig.pdf", file_name: "jane.pdf",
    });
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", unplaced: [],
      content: { contact: { name: "Jane Smith", phone: "(+91)-9123456780" }, skills: [], education: [] },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
    }) as unknown as typeof fetch;

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /re-parse/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Use all" }));
    expect(screen.getByPlaceholderText("Jane Smith")).toHaveValue("Jane Smith");
    expect(screen.getByRole("textbox", { name: "Phone number" })).toHaveValue("+91 91234 56780");
    expect(screen.queryByRole("region", { name: "Details from the uploaded résumé" })).toBeNull();
  });

  it("saves with an offer unanswered as Keep mine, and closes the offers", async () => {
    getCareerProfile.mockResolvedValue({
      ...withMasterResume, contact: { name: "Jane", email: "j@x.com" },
    });
    (apiClient.getOriginalResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      signed_url: "https://sb.example/orig.pdf", file_name: "jane.pdf",
    });
    (apiClient.readResumeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Jane's Resume", unplaced: [],
      content: { contact: { name: "Jane Smith" }, skills: [], education: [] },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
    }) as unknown as typeof fetch;

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /re-parse/i }));
    const offers = await screen.findByRole("region", { name: "Details from the uploaded résumé" });
    expect(offers).toHaveTextContent("Default: Keep mine. Saving without a choice keeps the profile's details.");
    expect(screen.getByRole("button", { name: "Keep mine (default)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    expect(upsertCareerProfile.mock.calls[0][0].contact.name).toBe("Jane");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Details from the uploaded résumé" })).toBeNull());
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
    // End is a month-year picker; ticked, it's a read-only "Present".
    expect(await screen.findByRole("button", { name: "End: Dec 2023" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "I work here now" }));
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("Present");
    expect((screen.getByLabelText("End") as HTMLInputElement).readOnly).toBe(true);

    await userEvent.click(screen.getByRole("checkbox", { name: "I work here now" }));
    expect(screen.getByRole("button", { name: "End: Dec 2023" })).toBeInTheDocument();
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

  it("asks for the Experience Level and saves the choice", async () => {
    getCareerProfile.mockResolvedValue(profile({ role_status: "student" }));
    renderPage();
    const level = await screen.findByLabelText("Experience Level");
    await waitFor(() => expect(level).toHaveValue("student"));
    await userEvent.selectOptions(level, "working");
    expect((await save()).role_status).toBe("working");
  });

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

  it("shows an uploaded summary past 80 words whole, and won't save it until it's trimmed", async () => {
    const long = Array.from({ length: 330 }, (_, i) => `w${i}`).join(" ");
    getCareerProfile.mockResolvedValue(profile({ summary: long }));
    renderPage();
    await screen.findByRole("heading", { name: "Summary" });
    const summary = document.getElementById("profile-summary") as HTMLTextAreaElement;
    expect(summary.value).toBe(long);
    expect(screen.getByText("330 / 80 words")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(await screen.findByText("The summary is 330 words. Trim it to 80 or fewer to save.")).toBeInTheDocument();
    expect(upsertCareerProfile).not.toHaveBeenCalled();
  });

  it("scrolls up to a save error at the top, each time it's shown", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      getCareerProfile.mockResolvedValue(profile({ summary: Array.from({ length: 90 }, (_, i) => `w${i}`).join(" ") }));
      renderPage();
      await screen.findByRole("heading", { name: "Summary" });
      await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Trim it to 80 or fewer to save.");
      await waitFor(() => expect(scrolled).toEqual([alert]));
      // The same message again still brings it back into view.
      await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
      await waitFor(() => expect(scrolled).toHaveLength(2));
      expect(scrolled[1]).toHaveTextContent("Trim it to 80 or fewer to save.");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
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

describe("My Profile — no repeats", () => {
  const profile = (extra: Record<string, unknown> = {}) => ({
    user_id: "u1", master_resume_id: null,
    contact: { name: "Jane", email: "j@x.com" },
    experience: [], projects: [], education: [], skills: ["JavaScript"], certifications: [],
    headline: null, role_status: null, photo_url: null, photo_path: null,
    created_at: "", updated_at: "",
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    upsertCareerProfile.mockResolvedValue({});
  });

  it("won't add a skill that's already there under another spelling, and says so", async () => {
    getCareerProfile.mockResolvedValue(profile());
    renderPage();
    const box = await screen.findByRole("combobox", { name: "Add a skill" });
    await userEvent.type(box, "javascript{Enter}");
    expect(await screen.findByText("JavaScript is already in your skills.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove JavaScript" })).toHaveLength(1);
  });

  it("flags a language listed twice and saves it once", async () => {
    getCareerProfile.mockResolvedValue(profile({ languages: [{ name: "Hindi", level: "" }, { name: "Telugu", level: "" }] }));
    renderPage();
    const second = await screen.findByRole("combobox", { name: "Language 2" });
    await userEvent.clear(second);
    await userEvent.type(second, "hindi");
    await userEvent.keyboard("{Escape}");
    expect(second).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Already listed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    // The page sends what's on it; the save keeps one (fitProfileSections).
    const { fitProfileSections } = await import("@/lib/profile-sections");
    expect(fitProfileSections(upsertCareerProfile.mock.calls[0][0]).languages.map((l: { name: string }) => l.name)).toEqual(["Hindi"]);
  });
});

describe("My Profile — month-year dates", () => {
  const profile = (experience: unknown[], projects: unknown[] = []) => ({
    user_id: "u1", master_resume_id: null,
    contact: { name: "Jane", email: "j@x.com" },
    experience, projects, education: [], skills: [], certifications: [],
    headline: null, role_status: null, photo_url: null, photo_path: null,
    created_at: "", updated_at: "",
  });
  const role = (start: string, end: string, current = false) => ({
    id: "e1", type: "full-time", company: "Acme", title: "Engineer", location: "",
    start, end, current, responsibilities: "", achievements: "", projects: "", impact: "",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    upsertCareerProfile.mockResolvedValue({});
  });

  it("converts dates typed before the picker, and saves them that way", async () => {
    getCareerProfile.mockResolvedValue(profile(
      [role("January 2021", "06/2023")],
      [{ id: "p1", name: "Site", techStack: "", start: "2022-03", end: "2022", description: "" }],
    ));
    renderPage();
    expect(await screen.findByRole("button", { name: "Start: Jan 2021" })).toBeInTheDocument();
    // Loading converted them; that alone isn't an unsaved change.
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
    await userEvent.type(screen.getByPlaceholderText("San Francisco, CA"), "Pune");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    const saved = upsertCareerProfile.mock.calls[0][0];
    expect(saved.experience[0]).toMatchObject({ start: "Jan 2021", end: "Jun 2023" });
    expect(saved.projects[0]).toMatchObject({ start: "Mar 2022", end: "2022" });
  });

  it("won't save an end before its start", async () => {
    getCareerProfile.mockResolvedValue(profile([role("Mar 2022", "Jan 2021")]));
    renderPage();
    expect(await screen.findByText("Ends before it starts.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(await screen.findByText(/An end date comes before its start \(Engineer\)/)).toBeInTheDocument();
    expect(upsertCareerProfile).not.toHaveBeenCalled();
  });
});

describe("My Profile — projects inside a role", () => {
  const role = (extra: Record<string, unknown> = {}) => ({
    id: "e1", type: "full-time", company: "Infosys", title: "Senior Systems Engineer", location: "",
    start: "Jun 2019", end: "", current: true, responsibilities: "", achievements: "", projects: "", impact: "",
    ...extra,
  });
  const profile = (experience: unknown[]) => ({
    user_id: "u1", master_resume_id: null, contact: { name: "Jane", email: "j@x.com" },
    experience, projects: [], education: [], skills: [], certifications: [],
    headline: null, role_status: null, photo_url: null, photo_path: null, created_at: "", updated_at: "",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    upsertCareerProfile.mockResolvedValue({});
  });

  it("shows what was in the old Projects box as the first card's name, and saves it there", async () => {
    getCareerProfile.mockResolvedValue(profile([role({ projects: "Payment gateway v2" })]));
    renderPage();
    // The card folds to its line, which is the moved text.
    await userEvent.click(await screen.findByRole("button", { name: /Payment gateway v2/ }));
    expect(screen.getByLabelText("Project name")).toHaveValue("Payment gateway v2");
    await userEvent.type(screen.getByPlaceholderText("San Francisco, CA"), "Pune");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    const saved = upsertCareerProfile.mock.calls[0][0].experience[0];
    expect(saved.projects).toBe("");
    expect(saved.workProjects).toEqual([expect.objectContaining({ name: "Payment gateway v2", responsibilities: "" })]);
  });

  it("adds a project card and saves what's typed into it", async () => {
    getCareerProfile.mockResolvedValue(profile([role()]));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add project" }));
    await userEvent.type(screen.getByLabelText("Client"), "Barclays");
    await userEvent.type(screen.getByLabelText("Responsibilities"), "Led the payments module");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(upsertCareerProfile).toHaveBeenCalled());
    expect(upsertCareerProfile.mock.calls[0][0].experience[0].workProjects).toEqual([
      expect.objectContaining({ client: "Barclays", responsibilities: "Led the payments module" }),
    ]);
  });

  it("won't save a project that ends before it starts", async () => {
    getCareerProfile.mockResolvedValue(profile([role({
      workProjects: [{ id: "p1", client: "Barclays", name: "", role: "", domain: "", start: "Mar 2022", end: "Jan 2021",
        techStack: "", responsibilities: "", achievements: "", impact: "" }],
    })]));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Barclays/ }));
    expect(screen.getByText("Ends before it starts.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(await screen.findByText(/An end date comes before its start \(Barclays\)/)).toBeInTheDocument();
    expect(upsertCareerProfile).not.toHaveBeenCalled();
  });
});
