// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getJd: vi.fn(),
    getResumes: vi.fn(),
    getJdDetails: vi.fn().mockResolvedValue({ session_id: null }),
    analyzeJd: vi.fn().mockResolvedValue({
      ats_score: 70,
      matched_skills: [],
      missing_skills: [],
      company_keywords: [],
    }),
    getJdCoverLetter: vi.fn().mockResolvedValue({ cover_letter_id: null, status: null, created_at: null }),
    generateCoverLetter: vi.fn(),
  },
}));

vi.mock("@/lib/career-profile-client", () => ({
  getCareerProfile: vi.fn().mockResolvedValue(null),
}));

import JDPage from "../app/(app)/jd/[jdId]/page";
import { useTailoringStore } from "../stores/tailoring-store";
import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

async function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // JDPage unwraps its `params` prop via React's `use()`, which suspends —
  // even though the test passes an already-resolved promise, the resulting
  // re-render after resolution needs to happen inside an awaited `act` or
  // it never flushes and testing-library's queries just see an empty tree.
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  return result;
}

const RESUME = {
  id: "resume-1",
  user_id: "u1",
  title: "Master Resume",
  template_id: "ats_clean",
  content: { contact: { name: "Jane Doe", email: "jane@example.com" }, experience: [], education: [], skills: [] },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const JD = {
  id: "jd-1",
  user_id: "u1",
  title: "Senior Backend Engineer",
  raw_text: "We need a senior backend engineer.",
  parsed_skills: [],
  status: "not_applied" as const,
  created_at: new Date().toISOString(),
};

describe("JDPage — Open (handleOpen)", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.getJd).mockResolvedValue(JD as any);
    vi.mocked(apiClient.getResumes).mockResolvedValue([RESUME] as any);
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ session_id: null } as any);
    vi.mocked(apiClient.analyzeJd).mockResolvedValue({
      ats_score: 70,
      matched_skills: [],
      missing_skills: [],
      company_keywords: [],
    });
  });

  // Regression: "Open" used to call setJd(jdId, jd.raw_text) before
  // navigating to Studio. That set the tailoring store's jdId, which makes
  // EditorPanel's hasJdContext true and collapses the content editor into
  // its JD-context "Expand to edit" state by default — so a resume the user
  // just asked to open rendered hidden behind a collapsed header, reading as
  // a blank or default Studio page instead of showing the tailored content.
  it("opens the resume saved for this JD (jdDetails.resume_id), without entering JD-tailoring mode", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({
      session_id: "session-1",
      resume_id: "resume-tailored-1",
      resume_title: "Resume — Acme",
      resume_pdf_url: null,
      ats_score: 82,
      session_created_at: new Date().toISOString(),
      questions_total: 0,
      questions_practiced: 0,
    } as any);

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    // Two "Open" buttons render once a tailored resume exists for this JD
    // (the always-shown Master Resume card, and the "Generated for This JD"
    // row) — both call the same handler, so either works.
    const [openButton] = await screen.findAllByText("Open");
    await userEvent.click(openButton);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/studio/resume-tailored-1"));

    // The bug: this used to be "jd-1", which is what collapsed the editor.
    expect(useTailoringStore.getState().jdId).toBeNull();
  });

  it("falls back to opening the base resume when no tailored resume is linked to this JD", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ session_id: null, resume_id: null } as any);

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    await userEvent.click(await screen.findByText("Open"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/studio/resume-1"));
    expect(useTailoringStore.getState().jdId).toBeNull();
  });
});

describe("JDPage — Cover Letter row", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.getJd).mockResolvedValue(JD as any);
    vi.mocked(apiClient.getResumes).mockResolvedValue([RESUME] as any);
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ session_id: null } as any);
    vi.mocked(apiClient.analyzeJd).mockResolvedValue({
      ats_score: 70, matched_skills: [], missing_skills: [], company_keywords: [],
    });
  });

  it("offers to generate a cover letter when none exists yet", async () => {
    vi.mocked(apiClient.getJdCoverLetter).mockResolvedValue({ cover_letter_id: null, status: null, created_at: null });
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-1", status: "pending" });

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    await userEvent.click(await screen.findByText("Generate"));

    await waitFor(() => expect(apiClient.generateCoverLetter).toHaveBeenCalledWith("resume-1", "jd-1", 50));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-1"));
  });

  it("offers to open an existing completed cover letter", async () => {
    vi.mocked(apiClient.getJdCoverLetter).mockResolvedValue({
      cover_letter_id: "cl-2", status: "completed", created_at: "2026-01-01T00:00:00Z",
    });

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    await userEvent.click(await screen.findByText("Open Letter"));
    expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-2");
  });

  // Regression: after generating, the ["jdCoverLetter", jdId] query wasn't
  // invalidated, so returning to this page within the app's default 60s
  // staleTime showed the stale "Not generated yet" state with a live,
  // re-clickable Generate button — inviting a second, wasted generation.
  it("invalidates the jdCoverLetter (and coverLetters) query cache after generating", async () => {
    vi.mocked(apiClient.getJdCoverLetter).mockResolvedValue({ cover_letter_id: null, status: null, created_at: null });
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-1", status: "pending" });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <JDPage params={Promise.resolve({ jdId: "jd-1" })} />
        </QueryClientProvider>
      );
    });

    await userEvent.click(await screen.findByText("Generate"));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jdCoverLetter", "jd-1"] })
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["coverLetters"] });
  });

  // Regression: the "Generate" button stayed clickable even while a
  // generation was already in flight (status "pending"), inviting a
  // duplicate, wasted LLM generation from a stale-looking button.
  it("disables Generate while a cover letter is already pending", async () => {
    vi.mocked(apiClient.getJdCoverLetter).mockResolvedValue({
      cover_letter_id: "cl-1", status: "pending", created_at: null,
    });

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    const generatingButton = await screen.findByRole("button", { name: /Generating…/ });
    expect(generatingButton).toBeDisabled();
  });
});
