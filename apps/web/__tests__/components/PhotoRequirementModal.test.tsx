// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// vi.hoisted keeps these fn refs available inside the hoisted vi.mock factories
// (canonical Vitest TDZ fix — assertions below are byte-unchanged).
const { uploadResumePhoto, uploadProfilePhoto, upsertCareerProfile } = vi.hoisted(() => ({
  uploadResumePhoto: vi.fn(),
  uploadProfilePhoto: vi.fn(),
  upsertCareerProfile: vi.fn(),
}));
vi.mock("@/lib/photo-upload", () => ({ uploadResumePhoto, uploadProfilePhoto }));

vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, upsertCareerProfile };
});

import { PhotoRequirementModal } from "../../components/resume/PhotoRequirementModal";
import { useResumeStore } from "../../stores/resume-store";

const CONTENT = { contact: { name: "Jane", email: "j@x.com" }, experience: [], education: [], skills: [] };
const PROFILE_INPUT = {
  master_resume_id: null, contact: { name: "Jane", email: "j@x.com" }, headline: null,
  experience: [], projects: [], education: [], skills: [], certifications: [],
  role_status: null, photo_url: null, photo_path: null,
};

function mount(props: Partial<React.ComponentProps<typeof PhotoRequirementModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhotoRequirementModal
        profilePhotoUrl={null}
        profileForUpsert={PROFILE_INPUT}
        onOpenProfile={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("PhotoRequirementModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResumeStore.getState().resetStore();
    useResumeStore.getState().setResume("resume-1", structuredClone(CONTENT), "ats_sidebar");
    uploadResumePhoto.mockResolvedValue("https://sb.example/avatars/u/resume-1.png");
    uploadProfilePhoto.mockResolvedValue({ url: "https://sb.example/avatars/u/profile.png", path: "u/profile.png" });
    upsertCareerProfile.mockResolvedValue({});
  });

  it("renders nothing while photoModalOpen is false", () => {
    mount();
    expect(screen.queryByText(/requires a profile photo/i)).not.toBeInTheDocument();
  });

  it("shows a 'Loading your profile…' line while the profile query is in flight", () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: undefined, profileForUpsert: null });

    expect(screen.getByText(/loading your profile/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("Case A: 'Use Profile Photo' copies the profile URL into content and closes", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: "https://sb.example/avatars/u/profile.png" });

    await userEvent.click(screen.getByRole("button", { name: /use profile photo/i }));

    expect(useResumeStore.getState().content!.contact.photo_url).toBe(
      "https://sb.example/avatars/u/profile.png",
    );
    expect(useResumeStore.getState().photoModalOpen).toBe(false);
  });

  it("Case A: 'Upload a Different Photo' with checkbox OFF sets only the resume photo", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: "https://sb.example/avatars/u/profile.png" });

    await userEvent.click(screen.getByRole("button", { name: /upload a different photo/i }));
    const file = new File(["x"], "new.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose an image|upload/i), file);

    await waitFor(() => expect(uploadResumePhoto).toHaveBeenCalledWith("resume-1", file));
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
    expect(upsertCareerProfile).not.toHaveBeenCalled();
    expect(useResumeStore.getState().content!.contact.photo_url).toBe(
      "https://sb.example/avatars/u/resume-1.png",
    );
  });

  it("Case A: ticking 'also set as my profile photo' also upserts the profile", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: "https://sb.example/avatars/u/profile.png" });

    await userEvent.click(screen.getByRole("button", { name: /upload a different photo/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /also set|also save/i }));
    const file = new File(["x"], "new.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose an image|upload/i), file);

    await waitFor(() => expect(uploadProfilePhoto).toHaveBeenCalledWith(file));
    expect(upsertCareerProfile).toHaveBeenCalledWith(
      expect.objectContaining({ photo_url: "https://sb.example/avatars/u/profile.png", photo_path: "u/profile.png" }),
    );
  });

  it("Case B: no profile photo — checkbox defaults checked; 'Open My Profile' fires the callback", async () => {
    const onOpenProfile = vi.fn();
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: null, onOpenProfile });

    expect(screen.getByText(/don't have a profile photo yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /upload photo/i }));
    expect(screen.getByRole("checkbox", { name: /also save|also set/i })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /open my profile/i }));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it("Case B: checkbox checked + no existing profile row still upserts, seeding contact from content", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: null, profileForUpsert: null });

    await userEvent.click(screen.getByRole("button", { name: /upload photo/i }));
    expect(screen.getByRole("checkbox", { name: /also save|also set/i })).toBeChecked();
    const file = new File(["x"], "new.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose an image|upload/i), file);

    await waitFor(() => expect(uploadProfilePhoto).toHaveBeenCalledWith(file));
    expect(upsertCareerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        photo_url: "https://sb.example/avatars/u/profile.png",
        photo_path: "u/profile.png",
        contact: expect.objectContaining({ name: "Jane", email: "j@x.com" }),
      }),
    );
  });

  it("Cancel reverts the template to photoModalRevertTo", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: null });
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useResumeStore.getState().templateId).toBe("ats_clean");
    expect(useResumeStore.getState().photoModalOpen).toBe(false);
  });

  it("shows an upload error and stays open", async () => {
    uploadResumePhoto.mockRejectedValue(new Error("Photo must be smaller than 5MB."));
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: null });
    await userEvent.click(screen.getByRole("button", { name: /upload photo/i }));
    const file = new File(["x"], "big.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose an image|upload/i), file);
    expect(await screen.findByText("Photo must be smaller than 5MB.")).toBeInTheDocument();
    expect(useResumeStore.getState().photoModalOpen).toBe(true);
  });
});
