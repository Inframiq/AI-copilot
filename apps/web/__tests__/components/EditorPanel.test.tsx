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
    rewriteBullet: vi.fn(),
    analyzeJd: vi.fn(),
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

  it("shows the full template grid on the sidebar-entry path (no JD context)", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<EditorPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "template" }));
    expect(screen.getByText("ATS Clean")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows a compact template dropdown instead of the grid when arriving from JD Analyzer", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-1", "Some job description text");
    render(<EditorPanel />);

    // Tailoring mode starts collapsed — expand to reach the tabs.
    await userEvent.click(screen.getByText("Expand to edit"));
    await userEvent.click(screen.getByRole("tab", { name: "template" }));

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByText("ATS Clean")).not.toBeInTheDocument();
  });

  it("shows a collapsible Job Description section on the JD-analyzer path, hidden on the sidebar-entry path", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-1", "We need a senior engineer with Python.");
    render(<EditorPanel />);

    expect(screen.getByText("Job Description")).toBeInTheDocument();
    // Collapsed by default — the text itself isn't rendered until expanded.
    expect(screen.queryByText("We need a senior engineer with Python.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Job Description"));
    expect(screen.getByText("We need a senior engineer with Python.")).toBeInTheDocument();
  });

  it("does not show the Job Description section on the sidebar-entry path", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<EditorPanel />);
    expect(screen.queryByText("Job Description")).not.toBeInTheDocument();
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
    // The bullet review screen (shown once tailoring completes) must not
    // duplicate the Writing Style slider already shown before generating —
    // every bullet here has its own Humanize button instead.
    await waitFor(() => {
      expect(screen.queryByText("Writing Style")).not.toBeInTheDocument();
    });
  });

  it("shows Reanalyze only after using per-bullet Humanize, and it re-scores without saving", async () => {
    const original = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", end: "Present", bullets: ["Built things"] }],
    };
    useResumeStore.getState().setResume("resume-1", original, "ats_clean");
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
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
      questions: [],
      company_keywords: [],
      suggested_skills: [],
    } as any);
    vi.mocked(apiClient.rewriteBullet).mockResolvedValue({
      rewritten_text: "Built things, naturally",
    } as any);
    vi.mocked(apiClient.analyzeJd).mockResolvedValue({
      ats_score: 40,
      matched_skills: [],
      missing_skills: ["React"],
      company_keywords: [],
    } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));
    await waitFor(() => expect(useTailoringStore.getState().sessionId).toBe("session-1"));

    // Changed bullets default to "accept" the moment tailoring completes,
    // but Accept All must still be visible (not gated on there being
    // anything left "undecided" — there never is, by design) so the user
    // has an explicit, always-available finalize action.
    expect(screen.getByText("Accept All")).toBeInTheDocument();

    expect(screen.queryByText("Reanalyze")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Humanize"));
    await waitFor(() => expect(apiClient.rewriteBullet).toHaveBeenCalled());
    expect(await screen.findByText("Reanalyze")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Reanalyze"));
    await waitFor(() => expect(apiClient.analyzeJd).toHaveBeenCalled());
    await waitFor(() => expect(useTailoringStore.getState().atsScore).toBe(40));
    expect(apiClient.updateResume).not.toHaveBeenCalled();
  });

  it("prompts for suggested skills only when none were picked, and adding them merges into the preview", async () => {
    const original = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", end: "Present", bullets: ["Built things"] }],
    };
    useResumeStore.getState().setResume("resume-1", original, "ats_clean");
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
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
      questions: [],
      company_keywords: [],
      suggested_skills: ["Kubernetes", "GraphQL"],
    } as any);
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "https://example.com/preview.pdf" } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));
    await waitFor(() => expect(useTailoringStore.getState().sessionId).toBe("session-1"));

    // No skill chip clicked — proceeding to preview must ask first.
    await userEvent.click(screen.getByText("Preview Tailored Resume"));
    expect(await screen.findByText("Add suggested skills?")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Add top 2"));

    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalled());
    const mergedContent = vi.mocked(apiClient.generatePdf).mock.calls[0][2];
    expect(mergedContent?.skills).toEqual(expect.arrayContaining(["Kubernetes", "GraphQL"]));
    expect(screen.queryByText("Add suggested skills?")).not.toBeInTheDocument();
  });

  it("does not prompt for suggested skills once the user has picked one manually", async () => {
    const original = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", end: "Present", bullets: ["Built things"] }],
    };
    useResumeStore.getState().setResume("resume-1", original, "ats_clean");
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
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
      questions: [],
      company_keywords: [],
      suggested_skills: ["Kubernetes"],
    } as any);
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "https://example.com/preview.pdf" } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));
    await waitFor(() => expect(useTailoringStore.getState().sessionId).toBe("session-1"));

    await userEvent.click(screen.getByText("Kubernetes"));
    await userEvent.click(screen.getByText("Preview Tailored Resume"));

    expect(screen.queryByText("Add suggested skills?")).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalled());
  });
});
