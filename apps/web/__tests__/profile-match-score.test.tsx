// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getLearningItems: vi.fn().mockResolvedValue([]),
    getJds: vi.fn().mockResolvedValue([]),
    getResumes: vi.fn().mockResolvedValue([]),
    createJd: vi.fn(),
    analyzeJd: vi.fn(),
  },
}));
vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile: vi.fn().mockResolvedValue(null) }));

import JDIndexPage from "../app/(app)/jd/page";
import { useTailoringStore } from "../stores/tailoring-store";
import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><JDIndexPage /></QueryClientProvider>);
}

beforeEach(() => {
  useTailoringStore.getState().resetStore();
  useResumeStore.getState().resetStore();
  vi.clearAllMocks();
});

/**
 * "Profile Match" means the résumé saved in the profile, measured against
 * this JD. It must not move because a tailoring run happened — the tailored
 * résumé is a different document, and until it is saved the profile's one is
 * unchanged.
 */
describe("Profile Match & Keywords", () => {
  it("records the analysis of the saved résumé separately from the tailored one", async () => {
    vi.mocked(apiClient.analyzeJd).mockResolvedValue({
      ats_score: 61, matched_skills: ["Python"], missing_skills: ["Go"],
      company_keywords: [], title_match: "partial", importance: {},
    } as never);
    useTailoringStore.setState({ jdId: "jd-1", jdText: "Senior engineer" } as never);
    await useTailoringStore.getState().runAnalysis("r1");
    expect(useTailoringStore.getState().profileAnalysis).toEqual({
      atsScore: 61, matchedSkills: ["Python"], missingSkills: ["Go"],
    });
  });

  it("shows the saved résumé's score, not the tailored one", async () => {
    // Exactly the reported state: analysed at 61, then a tailoring run
    // completed and wrote its own 88 into the shared fields.
    useTailoringStore.setState({
      profileAnalysis: { atsScore: 61, matchedSkills: ["Python"], missingSkills: ["Go"] },
      atsScore: 88, matchedSkills: ["Python", "Go"], missingSkills: [],
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText("61%")).toBeTruthy());
    expect(screen.queryByText("88%")).toBeNull();
  });

  it("shows the saved résumé's keywords too", async () => {
    useTailoringStore.setState({
      profileAnalysis: { atsScore: 61, matchedSkills: ["Python"], missingSkills: ["Go"] },
      atsScore: 88, matchedSkills: ["Python", "Terraform"], missingSkills: [],
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText("61%")).toBeTruthy());
    // Terraform belongs to the tailored résumé and was never in the profile's.
    expect(screen.queryByText("Terraform")).toBeNull();
  });

  it("clears it for a different JD", () => {
    useTailoringStore.setState({
      jdId: "jd-1", jdText: "A",
      profileAnalysis: { atsScore: 61, matchedSkills: [], missingSkills: [] },
    } as never);
    useTailoringStore.getState().setJd("jd-2", "B");
    expect(useTailoringStore.getState().profileAnalysis).toBeNull();
  });

  it("keeps it when the same JD is re-selected", () => {
    useTailoringStore.setState({
      jdId: "jd-1", jdText: "A",
      profileAnalysis: { atsScore: 61, matchedSkills: [], missingSkills: [] },
    } as never);
    useTailoringStore.getState().setJd("jd-1", "A");
    expect(useTailoringStore.getState().profileAnalysis?.atsScore).toBe(61);
  });
});
