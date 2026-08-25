// apps/web/__tests__/cover-letter-list-page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getCoverLetters: vi.fn().mockResolvedValue([]),
    getResumes: vi.fn().mockResolvedValue([
      { id: "resume-1", user_id: "u1", title: "Master Resume", template_id: "ats_clean", content: {}, created_at: "", updated_at: "" },
      { id: "resume-2", user_id: "u1", title: "Tailored — Acme", template_id: "ats_clean", content: {}, created_at: "", updated_at: "" },
    ]),
    getJds: vi.fn().mockResolvedValue([
      { id: "jd-1", user_id: "u1", title: "Backend Engineer", raw_text: "...", parsed_skills: [], status: "not_applied", created_at: "" },
    ]),
    getJdDetails: vi.fn(),
    generateCoverLetter: vi.fn(),
  },
}));

vi.mock("@/lib/career-profile-client", () => ({
  getCareerProfile: vi.fn(),
}));

import CoverLettersPage from "../app/(app)/cover-letters/page";
import { apiClient } from "../lib/api-client";
import { getCareerProfile } from "../lib/career-profile-client";

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const EMPTY_JD_DETAILS = {
  session_id: null, ats_score: null, resume_id: null, resume_title: null,
  resume_pdf_url: null, session_created_at: null, questions_total: 0, questions_practiced: 0,
};

describe("CoverLettersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCareerProfile).mockResolvedValue(null);
  });

  it("shows an empty state when there are no saved cover letters yet", async () => {
    renderWithQueryClient(<CoverLettersPage />);
    expect(await screen.findByText(/No cover letters yet/)).toBeInTheDocument();
  });

  it("auto-selects the resume already tailored for the chosen JD — no separate manual match-up required", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ ...EMPTY_JD_DETAILS, resume_id: "resume-2" });
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-1", status: "pending" });

    renderWithQueryClient(<CoverLettersPage />);
    await screen.findByText("Backend Engineer");

    await userEvent.selectOptions(screen.getByLabelText("Job Description"), "jd-1");

    await waitFor(() => expect(screen.getByLabelText("Resume")).toHaveValue("resume-2"));
    expect(screen.getByText(/Auto-selected: the resume tailored for this job description/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Generate Cover Letter"));
    await waitFor(() =>
      expect(apiClient.generateCoverLetter).toHaveBeenCalledWith("resume-2", "jd-1", 50, undefined, undefined)
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-1"));
  });

  it("falls back to the master resume when this JD has no tailored resume saved yet", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(EMPTY_JD_DETAILS);
    vi.mocked(getCareerProfile).mockResolvedValue({ master_resume_id: "resume-1" } as any);

    renderWithQueryClient(<CoverLettersPage />);
    await screen.findByText("Backend Engineer");

    await userEvent.selectOptions(screen.getByLabelText("Job Description"), "jd-1");

    await waitFor(() => expect(screen.getByLabelText("Resume")).toHaveValue("resume-1"));
    expect(screen.getByText(/Auto-selected: your master resume/)).toBeInTheDocument();
  });

  it("does not auto-fill anything when there's neither a tailored resume nor a master resume", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(EMPTY_JD_DETAILS);
    vi.mocked(getCareerProfile).mockResolvedValue(null);

    renderWithQueryClient(<CoverLettersPage />);
    await screen.findByText("Backend Engineer");

    await userEvent.selectOptions(screen.getByLabelText("Job Description"), "jd-1");

    await waitFor(() => expect(apiClient.getJdDetails).toHaveBeenCalledWith("jd-1"));
    expect(screen.getByLabelText("Resume")).toHaveValue("");
    expect(screen.getByText("Generate Cover Letter").closest("button")).toBeDisabled();
  });

  it("manually picking a different resume overrides the auto-fill and clears its hint", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ ...EMPTY_JD_DETAILS, resume_id: "resume-2" });

    renderWithQueryClient(<CoverLettersPage />);
    await screen.findByText("Master Resume");
    await screen.findByText("Backend Engineer");

    await userEvent.selectOptions(screen.getByLabelText("Job Description"), "jd-1");
    await waitFor(() => expect(screen.getByLabelText("Resume")).toHaveValue("resume-2"));

    await userEvent.selectOptions(screen.getByLabelText("Resume"), "resume-1");

    expect(screen.getByLabelText("Resume")).toHaveValue("resume-1");
    expect(screen.queryByText(/Auto-selected/)).not.toBeInTheDocument();
  });

  it("still allows generating with a fully manual resume + JD pick (no auto-fill data available)", async () => {
    vi.mocked(apiClient.getJdDetails).mockRejectedValue(new Error("not found"));
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-1", status: "pending" });

    renderWithQueryClient(<CoverLettersPage />);
    await screen.findByText("Master Resume");
    await screen.findByText("Backend Engineer");

    await userEvent.selectOptions(screen.getByLabelText("Job Description"), "jd-1");
    await waitFor(() => expect(apiClient.getJdDetails).toHaveBeenCalled());
    await userEvent.selectOptions(screen.getByLabelText("Resume"), "resume-1");
    await userEvent.click(screen.getByText("Generate Cover Letter"));

    await waitFor(() =>
      expect(apiClient.generateCoverLetter).toHaveBeenCalledWith("resume-1", "jd-1", 50, undefined, undefined)
    );
  });
});
