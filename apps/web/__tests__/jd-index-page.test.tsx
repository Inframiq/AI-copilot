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
    getLearningItems: vi.fn().mockResolvedValue([]),
    getJds: vi.fn().mockResolvedValue([]),
    getResumes: vi.fn().mockResolvedValue([]),
    createJd: vi.fn(),
    analyzeJd: vi.fn(),
  },
}));

vi.mock("@/lib/career-profile-client", () => ({
  getCareerProfile: vi.fn().mockResolvedValue(null),
}));

import JDIndexPage from "../app/(app)/jd/page";
import { useTailoringStore } from "../stores/tailoring-store";
import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("JDIndexPage — Tailor Resume", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
  });

  // Regression: clicking "Tailor Resume" right after a completed analysis
  // wiped the just-computed ATS score / matched / missing skills before
  // navigating to Studio, because handleTailor's defensive setJd() re-sync
  // (same jdId/jdText, not a real JD change) also resets those fields —
  // needed so a genuinely *different* JD doesn't carry over the previous
  // one's badge, but this call isn't that case. Studio's TailoringForm
  // reads those fields straight off the store, so nothing auto-populated.
  it("keeps the ATS score and matched/missing skills after clicking Tailor Resume, instead of wiping them", async () => {
    useResumeStore.getState().setResume(
      "resume-1",
      { contact: { name: "Jane Doe", email: "jane@example.com" }, experience: [], education: [], skills: [] },
      "ats_clean"
    );
    useTailoringStore.getState().setJd("jd-1", "We need a senior engineer with Python.");
    useTailoringStore.setState({
      atsScore: 72,
      matchedSkills: ["Python"],
      missingSkills: ["AWS"],
    });

    renderWithQueryClient(<JDIndexPage />);

    await userEvent.click(await screen.findByText("Tailor Resume"));

    const state = useTailoringStore.getState();
    expect(state.atsScore).toBe(72);
    expect(state.matchedSkills).toEqual(["Python"]);
    expect(state.missingSkills).toEqual(["AWS"]);
    expect(state.jdId).toBe("jd-1");
    expect(state.jdText).toBe("We need a senior engineer with Python.");
    expect(mockPush).toHaveBeenCalledWith("/studio/resume-1");
  });

  // End-to-end human flow, driven entirely through the real UI (not by
  // pre-seeding the store): paste JD1, Analyze, confirm the Save-As modal,
  // Tailor Resume, navigate back to JD Analyzer (component unmount+remount
  // — the store and query cache survive that, same as a real client-side
  // nav), paste a second, unrelated JD, Analyze, Tailor Resume again. None
  // of JD1's analysis or priority-skill picks should still be present once
  // JD2's own analysis has completed.
  it("does not leak ATS results or priority skills from one JD into the next", async () => {
    const user = userEvent.setup();
    useResumeStore.getState().setResume(
      "resume-1",
      { contact: { name: "Jane Doe", email: "jane@example.com" }, experience: [], education: [], skills: [] },
      "ats_clean"
    );

    vi.mocked(apiClient.createJd).mockResolvedValueOnce({
      id: "jd-1",
      user_id: "u1",
      title: "Backend Engineer role",
      raw_text: "Backend Engineer role needing Python and AWS.",
      parsed_skills: [],
      status: "not_applied",
      created_at: new Date().toISOString(),
    } as any);
    vi.mocked(apiClient.analyzeJd).mockResolvedValueOnce({
      ats_score: 40,
      matched_skills: ["Python"],
      missing_skills: ["AWS"],
      company_keywords: ["fast-paced"],
    });

    const { unmount } = renderWithQueryClient(<JDIndexPage />);

    await user.type(
      screen.getByPlaceholderText(/Paste the full job description here/),
      "Backend Engineer role needing Python and AWS."
    );
    await user.click(screen.getByText("Analyze Description"));

    // Save-As modal — brand-new JD text, so it must be named before analysis runs.
    await user.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() => expect(useTailoringStore.getState().atsScore).toBe(40));
    expect(useTailoringStore.getState().jdId).toBe("jd-1");

    // Flag a "Not Matched" keyword as a priority pick for JD1 — this is
    // local component state (selectedPriority) until "Tailor Resume" is
    // clicked, which is what actually pushes it into the store.
    await user.click(screen.getByText("AWS"));

    await user.click(screen.getByText("Tailor Resume"));
    expect(mockPush).toHaveBeenCalledWith("/studio/resume-1");
    expect(useTailoringStore.getState().prioritySkills).toEqual(["AWS"]);

    // Simulate navigating away to Studio and back to JD Analyzer — the
    // store and query cache persist across this, a full component remount
    // does not reset either.
    unmount();

    vi.mocked(apiClient.createJd).mockResolvedValueOnce({
      id: "jd-2",
      user_id: "u1",
      title: "Frontend Engineer role",
      raw_text: "Frontend Engineer role needing React and TypeScript.",
      parsed_skills: [],
      status: "not_applied",
      created_at: new Date().toISOString(),
    } as any);
    vi.mocked(apiClient.analyzeJd).mockResolvedValueOnce({
      ats_score: 85,
      matched_skills: ["React", "TypeScript"],
      missing_skills: ["GraphQL"],
      company_keywords: [],
    });

    renderWithQueryClient(<JDIndexPage />);

    const jdTextarea = screen.getByPlaceholderText(/Paste the full job description here/);
    await user.clear(jdTextarea);
    await user.type(jdTextarea, "Frontend Engineer role needing React and TypeScript.");
    await user.click(screen.getByText("Analyze Description"));
    await user.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() => expect(useTailoringStore.getState().atsScore).toBe(85));

    const state = useTailoringStore.getState();
    expect(state.jdId).toBe("jd-2");
    expect(state.matchedSkills).toEqual(["React", "TypeScript"]);
    expect(state.missingSkills).toEqual(["GraphQL"]);
    // JD1's priority-skill pick must be gone.
    expect(state.prioritySkills).toEqual([]);

    await user.click(screen.getByText("Tailor Resume"));

    const finalState = useTailoringStore.getState();
    expect(finalState.atsScore).toBe(85);
    expect(finalState.matchedSkills).toEqual(["React", "TypeScript"]);
    expect(finalState.missingSkills).toEqual(["GraphQL"]);
    expect(finalState.jdId).toBe("jd-2");
    expect(finalState.prioritySkills).toEqual([]);
  });
});
