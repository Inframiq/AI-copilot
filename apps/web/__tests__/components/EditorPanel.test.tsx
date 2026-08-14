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
    getSession: vi.fn(),
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

  it("caps the Summary tab at 80 words instead of accepting an unbounded paste", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<EditorPanel />);

    await userEvent.click(screen.getByRole("tab", { name: "summary" }));
    const textarea = screen.getByPlaceholderText(/Write a compelling professional summary/);

    const oversized = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    // userEvent.type is too slow for 120 words in a single test; paste
    // simulates the real-world trigger (pasting a long paragraph) and
    // exercises the same onChange path.
    await userEvent.click(textarea);
    await userEvent.paste(oversized);

    await waitFor(() => {
      const words = (useResumeStore.getState().content?.summary ?? "").split(/\s+/).filter(Boolean);
      expect(words.length).toBe(80);
      expect(words[0]).toBe("word0");
    });
    expect(screen.getByText("80 / 80 words")).toBeInTheDocument();
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "completed",
      ats_score: 70,
      matched_skills: ["React"],
      missing_skills: [],
      tailored_content: SAMPLE_CONTENT,
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

  it("shows an error message instead of silently resetting when tailoring fails (manual-paste path)", async () => {
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "failed",
      ats_score: null,
      matched_skills: [],
      missing_skills: [],
      tailored_content: null,
      company_keywords: [],
      suggested_skills: [],
    } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));

    // Previously this failure was completely silent — the button just reset
    // with no indication anything went wrong, which read as "nothing is
    // happening" / a hang rather than a completed, failed attempt.
    await waitFor(() => {
      expect(screen.getByText("Tailoring failed — please try again.")).toBeInTheDocument();
    });
    expect(useTailoringStore.getState().isLoading).toBe(false);
    // The JD text the user typed must survive the failure — a silent
    // failure with no visible cause is what drives users to refresh the
    // page, which (with no store persistence) is what actually loses it.
    // (createJd ran as part of starting tailoring, so jdId is now set and
    // the panel has switched to the JD-context view — that's expected;
    // what matters is the text itself wasn't dropped.)
    expect(useTailoringStore.getState().jdText).toBe("Senior Backend Engineer role");
  });

  it("shows an error message on the JD-analyzer path when tailoring fails, keeping the JD context visible", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-1", "We need a senior engineer with Python.");
    vi.mocked(apiClient.tailorResume).mockResolvedValue({
      session_id: "session-1",
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "failed",
      ats_score: null,
      matched_skills: [],
      missing_skills: [],
      tailored_content: null,
      company_keywords: [],
      suggested_skills: [],
    } as any);

    render(<EditorPanel />);
    await userEvent.click(screen.getByText("Tailor Resume"));

    await waitFor(() => {
      expect(screen.getByText("Tailoring failed — please try again.")).toBeInTheDocument();
    });
    // hasJdContext stays true (jdId untouched by a failed run), so the JD
    // context — not just the error — must still be there for a retry.
    expect(useTailoringStore.getState().jdId).toBe("jd-1");
    expect(useTailoringStore.getState().jdText).toBe("We need a senior engineer with Python.");
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "completed",
      ats_score: 70,
      matched_skills: ["React"],
      missing_skills: [],
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
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

    // Changed bullets default to "accept" the moment tailoring completes, so
    // the button reflects that state immediately rather than reading the
    // same "Accept All" regardless of what's already true.
    expect(screen.getByText("All Bullets Accepted")).toBeInTheDocument();

    // Rejecting a bullet flips the button back to an actionable state.
    await userEvent.click(screen.getByText("Keep original"));
    expect(screen.getByText("Accept All")).toBeInTheDocument();
    expect(screen.queryByText("All Bullets Accepted")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Accept All"));
    expect(screen.getByText("All Bullets Accepted")).toBeInTheDocument();

    expect(screen.queryByText("Reanalyze")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Humanize"));
    await waitFor(() => expect(apiClient.rewriteBullet).toHaveBeenCalled());
    expect(await screen.findByText("Reanalyze")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Reanalyze"));
    await waitFor(() => expect(apiClient.analyzeJd).toHaveBeenCalled());
    await waitFor(() => expect(useTailoringStore.getState().atsScore).toBe(40));
    expect(apiClient.updateResume).not.toHaveBeenCalled();
  });

  it("never adds suggested skills to the preview unless the user explicitly picks them", async () => {
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "completed",
      ats_score: 70,
      matched_skills: ["React"],
      missing_skills: [],
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
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

    // No skill chip clicked — preview must go straight through with the
    // resume's original skills untouched, no auto-populated suggestions.
    await userEvent.click(screen.getByText("Preview Tailored Resume"));

    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalled());
    const mergedContent = vi.mocked(apiClient.generatePdf).mock.calls[0][2];
    expect(mergedContent?.skills).toEqual(original.skills);
    expect(mergedContent?.skills).not.toEqual(expect.arrayContaining(["Kubernetes", "GraphQL"]));
  });

  it("offers Regenerate Preview after Humanize invalidates an already-rendered preview", async () => {
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "completed",
      ats_score: 70,
      matched_skills: ["React"],
      missing_skills: [],
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
      company_keywords: [],
      suggested_skills: [],
    } as any);
    vi.mocked(apiClient.rewriteBullet).mockResolvedValue({
      rewritten_text: "Built things, naturally",
    } as any);
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "https://example.com/preview.pdf" } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));
    await waitFor(() => expect(useTailoringStore.getState().sessionId).toBe("session-1"));

    // Generate the first preview.
    await userEvent.click(screen.getByText("Preview Tailored Resume"));
    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalledTimes(1));
    expect(useTailoringStore.getState().previewPdfUrl).toBe("https://example.com/preview.pdf");
    expect(screen.getByText("Save…")).toBeInTheDocument();

    // Humanizing after a preview already exists must invalidate it — not
    // silently leave the Download/Save panel pointing at stale content —
    // and surface an obvious way to regenerate.
    await userEvent.click(screen.getByText("Humanize"));
    await waitFor(() => expect(apiClient.rewriteBullet).toHaveBeenCalled());

    expect(useTailoringStore.getState().previewPdfUrl).toBeNull();
    expect(screen.queryByText("Save…")).not.toBeInTheDocument();
    expect(await screen.findByText("Regenerate Preview")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Regenerate Preview"));
    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalledTimes(2));
    const secondCallContent = vi.mocked(apiClient.generatePdf).mock.calls[1][2];
    expect(secondCallContent?.experience[0].bullets[0]).toBe("Built things, naturally");
  });

  it("adds a suggested skill to the preview once the user picks it manually", async () => {
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "completed",
      ats_score: 70,
      matched_skills: ["React"],
      missing_skills: [],
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
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

    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalled());
    const mergedContent = vi.mocked(apiClient.generatePdf).mock.calls[0][2];
    expect(mergedContent?.skills).toEqual(expect.arrayContaining(["Kubernetes"]));
  });

  it("Auto-select Top N picks the best-fit skills by tier, favoring existing skills over suggestions on ties", async () => {
    const manyOriginalSkills = Array.from({ length: 25 }, (_, i) => `Original Skill ${i}`);
    const original = {
      ...SAMPLE_CONTENT,
      skills: manyOriginalSkills,
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "completed",
      ats_score: 70,
      matched_skills: [],
      // "Kubernetes" is a real JD gap → High. "Original Skill 0" and
      // "Docker" are ATS keywords for this company → Medium. Everything
      // else (24 more original skills, "GraphQL") is Low.
      missing_skills: ["Kubernetes"],
      tailored_content: {
        ...original,
        experience: [{ ...original.experience[0], bullets: ["Built things using React"] }],
      },
      company_keywords: ["Original Skill 0", "Docker"],
      suggested_skills: ["Kubernetes", "Docker", "GraphQL"],
    } as any);
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "https://example.com/preview.pdf" } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));
    await waitFor(() => expect(useTailoringStore.getState().sessionId).toBe("session-1"));

    await userEvent.click(await screen.findByText("Auto-select Top 20 for this JD"));
    await userEvent.click(screen.getByText("Preview Tailored Resume"));

    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalled());
    const mergedContent = vi.mocked(apiClient.generatePdf).mock.calls[0][2];
    expect(mergedContent?.skills).toHaveLength(20);
    expect(mergedContent?.skills).toEqual(
      expect.arrayContaining(["Kubernetes", "Original Skill 0", "Docker"])
    );
    // Low-tier "GraphQL" (a suggestion) loses the tie-break to the 17
    // remaining Low-tier ORIGINAL skills that fill out the rest of the cap.
    expect(mergedContent?.skills).not.toContain("GraphQL");
  });

  it("rewrites the professional summary for the JD, and separately via a custom instruction", async () => {
    const original = {
      ...SAMPLE_CONTENT,
      summary: "Original summary text.",
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
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-1",
      jd_id: "jd-1",
      status: "completed",
      ats_score: 70,
      matched_skills: ["React"],
      missing_skills: [],
      // Bullets identical to original — no bullet changes to review, so
      // only the Summary block renders (avoids the per-bullet Rewrite/
      // Humanize buttons, which share button text with the summary's).
      tailored_content: original,
      company_keywords: [],
      suggested_skills: [],
    } as any);

    render(<EditorPanel />);
    await userEvent.type(
      screen.getByPlaceholderText(/Paste the job description/),
      "Senior Backend Engineer role"
    );
    await userEvent.click(screen.getByText("Tailor Resume"));
    await waitFor(() => expect(useTailoringStore.getState().sessionId).toBe("session-1"));

    expect(await screen.findByText("Original summary text.")).toBeInTheDocument();

    vi.mocked(apiClient.rewriteBullet).mockResolvedValueOnce({
      rewritten_text: "AI-tailored summary for this JD.",
    } as any);
    await userEvent.click(screen.getByText("Rewrite for this JD"));

    await waitFor(() =>
      expect(apiClient.rewriteBullet).toHaveBeenCalledWith(
        expect.objectContaining({
          bullet_text: "Original summary text.",
          mode: "rewrite",
          field: "summary",
          jd_context: "Senior Backend Engineer role",
        })
      )
    );
    expect(await screen.findByText("AI-tailored summary for this JD.")).toBeInTheDocument();
    // The original now shows struck through as the diff, and Accept/Keep
    // original become available, same as a bullet change.
    expect(screen.getByText("Keep original")).toBeInTheDocument();

    // A custom instruction rewrites it again, independent of the JD-rewrite above.
    vi.mocked(apiClient.rewriteBullet).mockResolvedValueOnce({
      rewritten_text: "Summary rewritten per custom instructions.",
    } as any);
    await userEvent.type(
      screen.getByPlaceholderText(/describe how you want it written/i),
      "Lead with leadership experience"
    );
    await userEvent.click(screen.getByRole("button", { name: /^Rewrite$/ }));

    await waitFor(() =>
      expect(apiClient.rewriteBullet).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mode: "custom",
          field: "summary",
          custom_instruction: "Lead with leadership experience",
        })
      )
    );
    expect(await screen.findByText("Summary rewritten per custom instructions.")).toBeInTheDocument();
  });
});
