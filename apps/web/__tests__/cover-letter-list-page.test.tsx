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
    ]),
    getJds: vi.fn().mockResolvedValue([
      { id: "jd-1", user_id: "u1", title: "Backend Engineer", raw_text: "...", parsed_skills: [], status: "not_applied", created_at: "" },
    ]),
    generateCoverLetter: vi.fn(),
  },
}));

import CoverLettersPage from "../app/(app)/cover-letters/page";
import { apiClient } from "../lib/api-client";

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("CoverLettersPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates a cover letter from the selected resume and JD, then navigates to it", async () => {
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-1", status: "pending" });

    renderWithQueryClient(<CoverLettersPage />);

    // Wait for the resumes/JDs queries to resolve and populate the <option>
    // elements — the <select> itself renders synchronously, but selecting
    // "resume-1" before the async data lands has no matching option yet.
    await screen.findByText("Master Resume");
    await screen.findByText("Backend Engineer");

    await userEvent.selectOptions(screen.getByLabelText("Resume"), "resume-1");
    await userEvent.selectOptions(screen.getByLabelText("Job Description"), "jd-1");
    await userEvent.click(screen.getByText("Generate Cover Letter"));

    await waitFor(() =>
      expect(apiClient.generateCoverLetter).toHaveBeenCalledWith("resume-1", "jd-1", 50, undefined, undefined)
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-1"));
  });

  it("shows an empty state when there are no saved cover letters yet", async () => {
    renderWithQueryClient(<CoverLettersPage />);
    expect(await screen.findByText(/No cover letters yet/)).toBeInTheDocument();
  });
});
