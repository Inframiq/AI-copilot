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
    generateJdPrepQuestions: vi.fn(),
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

    // Exactly one "Open" renders now — the one in the "Generated for This
    // JD" row, beside the resume it opens. The Resume Builder card's
    // duplicate (same handler, no adjacent resume) was removed.
    const [openButton] = await screen.findAllByText("Open");
    await userEvent.click(openButton);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/studio/resume-tailored-1"));

    // The bug: this used to be "jd-1", which is what collapsed the editor.
    expect(useTailoringStore.getState().jdId).toBeNull();
  });

  // A tailor run happened for this JD (so the "Generated for This JD" row,
  // which owns the only Open button, renders) but no resume was ever saved
  // against it — handleOpen falls back to the master resume.
  it("falls back to opening the base resume when no tailored resume is linked to this JD", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ session_id: "session-1", resume_id: null } as any);

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    await userEvent.click(await screen.findByText("Open"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/studio/resume-1"));
    expect(useTailoringStore.getState().jdId).toBeNull();
  });
});

describe("JDPage — Tailor with a target company", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.getJd).mockResolvedValue(JD as any);
    vi.mocked(apiClient.getResumes).mockResolvedValue([RESUME] as any);
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ session_id: null } as any);
  });

  // The review page starts the run the moment it opens, so the company has to
  // be in the store before the navigation — and survive setJd clearing it for
  // a JD the store wasn't on yet.
  it("puts the typed company in the store for the run, even coming from another JD", async () => {
    useTailoringStore.getState().setJd("jd-other", "Some other JD");
    useTailoringStore.getState().setCompanyName("Old Co");

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    const field = await screen.findByLabelText(/Target Company/);
    // Another JD's company is not carried over.
    expect(field).toHaveValue("");
    await userEvent.type(field, "  Stripe ");
    await userEvent.click(screen.getByRole("button", { name: /Tailor/ }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/studio/resume-1/review"));
    expect(useTailoringStore.getState().jdId).toBe("jd-1");
    expect(useTailoringStore.getState().companyName).toBe("Stripe");
  });
});

describe("JDPage — Interview Practice row", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.getJd).mockResolvedValue(JD as any);
    vi.mocked(apiClient.getResumes).mockResolvedValue([RESUME] as any);
  });

  const details = (over: object) => ({
    session_id: "run-latest", resume_id: "resume-1", resume_title: "R", resume_pdf_url: null,
    ats_score: 80, session_created_at: new Date().toISOString(),
    questions_total: 0, questions_practiced: 0, questions_session_id: null, resume_saved: false,
    ...over,
  });

  it("practices the run that holds the questions, not simply the latest run", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(
      details({ questions_total: 8, questions_practiced: 3, questions_session_id: "run-saved", resume_saved: true }) as any,
    );
    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);
    expect(await screen.findByText("3 of 8 questions practiced")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Practice" }));
    expect(mockPush).toHaveBeenCalledWith("/interview/run-saved");
  });

  it("only points an unsaved JD at Save to JD — analyzing alone makes no questions", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(details({ resume_saved: false }) as any);
    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);
    expect(await screen.findByText(/Save your tailored résumé to this job/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate questions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Practice" })).toBeNull();
  });

  it("generates questions for a saved JD that has none", async () => {
    vi.mocked(apiClient.getJdDetails)
      .mockResolvedValueOnce(details({ resume_saved: true }) as any)
      .mockResolvedValue(details({ resume_saved: true, questions_total: 10, questions_session_id: "run-saved" }) as any);
    vi.mocked(apiClient.generateJdPrepQuestions).mockResolvedValue({ session_id: "run-saved", questions_total: 10 });

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);
    await userEvent.click(await screen.findByRole("button", { name: /Generate questions/ }));

    expect(apiClient.generateJdPrepQuestions).toHaveBeenCalledWith("jd-1");
    expect(await screen.findByText("0 of 10 questions practiced")).toBeInTheDocument();
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
