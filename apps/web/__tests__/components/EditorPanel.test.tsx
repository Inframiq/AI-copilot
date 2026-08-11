// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/photo-upload", () => ({
  uploadResumePhoto: vi.fn(),
}));

// A successful tailor run populates pendingContent, which makes EditorPanel
// render BulletReviewPanel — and that component calls useRouter() (added
// alongside the tailoring preview/save flow), which throws outside a real
// Next.js App Router context unless mocked here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    updateResume: vi.fn().mockResolvedValue({}),
    tailorResume: vi.fn(),
    generatePdf: vi.fn(),
    createJd: vi.fn(),
  },
}));

import { EditorPanel } from "../../components/resume/EditorPanel";
import { useResumeStore } from "../../stores/resume-store";
import { useTailoringStore } from "../../stores/tailoring-store";
import { apiClient } from "../../lib/api-client";
import { uploadResumePhoto } from "../../lib/photo-upload";

const SAMPLE_CONTENT = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  headline: "Senior Engineer",
  experience: [],
  education: [],
  skills: ["React"],
};

describe("EditorPanel", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.updateResume).mockResolvedValue({} as any);
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "https://example.com/r.pdf" } as any);
  });

  it("shows a loading state when no resume content is loaded", () => {
    render(<EditorPanel />);
    expect(screen.getByText("Loading resume…")).toBeInTheDocument();
  });

  it("renders the editor once content is loaded, defaulting to the Template tab", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<EditorPanel />);
    expect(screen.getByText("Content Editor")).toBeInTheDocument();
    expect(screen.getByText(/Choose the layout/)).toBeInTheDocument();
  });

  it("hides JD tailoring until the resume has experience, education, or skills", () => {
    useResumeStore.getState().setResume("resume-1", {
      contact: { name: "Jane Doe", email: "jane@example.com" },
      headline: "",
      experience: [],
      education: [],
      skills: [],
    }, "ats_clean");
    render(<EditorPanel />);
    expect(screen.queryByText("Tailor Resume")).not.toBeInTheDocument();
    expect(screen.getByText(/unlock AI tailoring/)).toBeInTheDocument();
  });

  it("editing a contact field on the Contact tab updates the resume store", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<EditorPanel />);

    await userEvent.click(screen.getByRole("tab", { name: "contact" }));
    const nameInput = screen.getByDisplayValue("Jane Doe");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "John Smith");

    await waitFor(() => {
      expect(useResumeStore.getState().content?.contact.name).toBe("John Smith");
    });
  });

  it("uploads a profile photo and stores the returned URL", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    vi.mocked(uploadResumePhoto).mockResolvedValue("https://cdn.example.com/photo.jpg");
    render(<EditorPanel />);

    await userEvent.click(screen.getByRole("tab", { name: "contact" }));
    const fileInput = screen.getByLabelText(/Upload Photo/) as HTMLInputElement;
    const file = new File(["fake"], "photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(useResumeStore.getState().content?.contact.photo_url).toBe(
        "https://cdn.example.com/photo.jpg"
      );
    });
  });

  it("shows a photo upload error without crashing", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    vi.mocked(uploadResumePhoto).mockRejectedValue(new Error("Upload failed: too large"));
    render(<EditorPanel />);

    await userEvent.click(screen.getByRole("tab", { name: "contact" }));
    const fileInput = screen.getByLabelText(/Upload Photo/) as HTMLInputElement;
    const file = new File(["fake"], "photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(fileInput, file);

    expect(await screen.findByText("Upload failed: too large")).toBeInTheDocument();
  });

  it("Tailor Resume is disabled until JD text is entered", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<EditorPanel />);
    expect(screen.getByText("Tailor Resume").closest("button")).toBeDisabled();
  });

  it("typing JD text and clicking Tailor Resume triggers the tailoring flow", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    vi.mocked(apiClient.createJd).mockResolvedValue({
      id: "jd-1",
      user_id: "u1",
      title: "Senior Backend Engineer",
      raw_text: "Senior Backend Engineer role",
      parsed_skills: [],
      status: "applied",
      created_at: new Date().toISOString(),
    } as any);
    vi.mocked(apiClient.tailorResume).mockResolvedValue({
      session_id: "session-1",
      ats_score: 70,
      matched_skills: ["React"],
      missing_skills: [],
      tailored_content: SAMPLE_CONTENT,
      questions: [],
      company_keywords: [],
      suggested_skills: [],
    } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));

    await waitFor(() => {
      expect(apiClient.tailorResume).toHaveBeenCalledWith("resume-1", "jd-1", 50, undefined, []);
    });
    await waitFor(() => {
      expect(useTailoringStore.getState().sessionId).toBe("session-1");
    });
  });
});
