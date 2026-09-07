// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    rewriteBullet: vi.fn(),
    analyzeJd: vi.fn(),
    generatePdf: vi.fn(),
  },
}));

const { getCareerProfile } = vi.hoisted(() => ({ getCareerProfile: vi.fn() }));
vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, getCareerProfile };
});

import { BulletReviewPanel } from "../../components/resume/BulletReviewPanel";
import { useResumeStore } from "../../stores/resume-store";
import { useTailoringStore } from "../../stores/tailoring-store";

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BulletReviewPanel />
    </QueryClientProvider>,
  );
}

describe("BulletReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the open resume is not the profile's master resume.
    getCareerProfile.mockResolvedValue(null);
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
  });
  afterEach(() => cleanup());

  it("shows an importance badge on a bullet the JD mapping rated", () => {
    useResumeStore.getState().setResume(
      "resume-1",
      {
        contact: { name: "Jane", email: "jane@example.com" },
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing"] }],
        education: [],
        skills: [],
      },
      "ats_clean",
    );
    useTailoringStore.setState({
      pendingContent: {
        contact: { name: "Jane", email: "jane@example.com" },
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing with Python"] }],
        education: [],
        skills: [],
      },
      bulletImportance: { exp0_b0: "high" },
    } as never);

    const { getAllByTestId } = renderPanel();
    expect(
      getAllByTestId("importance-badge").some((b) => b.getAttribute("data-level") === "high"),
    ).toBe(true);
  });

  const emptyContent = {
    contact: { name: "Jane", email: "jane@example.com" },
    experience: [],
    education: [],
    skills: [],
  };

  const skillFix = {
    id: "skill:kubernetes", type: "skill", gap: "Kubernetes", importance: "high",
    grounded: true, text: "Kubernetes", experience_index: null, score_delta: 8, default_accept: false,
  };

  it("shows a JD-gap skill fix once, as a chip in the single skills section", () => {
    useResumeStore.getState().setResume("resume-1", emptyContent, "ats_clean");
    useTailoringStore.setState({
      pendingContent: emptyContent,
      suggestedSkills: ["Kubernetes", "Redis"],
      atsFixes: [skillFix],
    } as never);

    const { queryAllByRole } = renderPanel();
    const k8s = queryAllByRole("button", { name: /Kubernetes/ });
    expect(k8s.length).toBe(1); // the fix chip, not also a plain suggestion
    expect(queryAllByRole("button", { name: /Redis/ }).length).toBe(1);
  });

  it("accepting the gap-skill chip records a fix: decision", () => {
    useResumeStore.getState().setResume("resume-1", emptyContent, "ats_clean");
    useTailoringStore.setState({
      pendingContent: emptyContent,
      suggestedSkills: ["Redis"],
      atsFixes: [skillFix],
    } as never);

    const { getByRole } = renderPanel();
    getByRole("button", { name: /Kubernetes/ }).click();
    expect(useTailoringStore.getState().bulletDecisions["fix:skill:kubernetes"]).toBe("accept");
  });

  it("keeps every suggested skill when there are no ats fixes (legacy session)", () => {
    useResumeStore.getState().setResume("resume-1", emptyContent, "ats_clean");
    useTailoringStore.setState({
      pendingContent: emptyContent,
      suggestedSkills: ["Kubernetes", "Redis"],
      atsFixes: [],
    } as never);

    const { queryByRole } = renderPanel();
    expect(queryByRole("button", { name: /Redis/ })).not.toBeNull();
    expect(queryByRole("button", { name: /Kubernetes/ })).not.toBeNull();
  });

  it("shows current → projected ATS score in the review header", () => {
    useResumeStore.getState().setResume(
      "resume-1",
      {
        contact: { name: "Jane", email: "jane@example.com" },
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing"] }],
        education: [],
        skills: [],
      },
      "ats_clean",
    );
    useTailoringStore.setState({
      atsScore: 60,
      projectedAtsScore: 72,
      pendingContent: {
        contact: { name: "Jane", email: "jane@example.com" },
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing better"] }],
        education: [],
        skills: [],
      },
    } as never);

    const { container } = renderPanel();
    expect(container.textContent).toMatch(/ATS Score:\s*60%\s*→\s*72%/);
  });

  const changedOriginal = {
    contact: { name: "Jane", email: "jane@example.com" },
    experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing"] }],
    education: [],
    skills: [],
  };
  const changedPending = {
    ...changedOriginal,
    experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing with Python"] }],
  };

  it("offers only 'Save as new' when tailoring the profile's master resume", async () => {
    getCareerProfile.mockResolvedValue({ master_resume_id: "resume-1" });
    useResumeStore.getState().setResume("resume-1", changedOriginal, "ats_clean");
    useTailoringStore.setState({
      pendingContent: changedPending,
      mergedContent: changedPending,
      previewPdfUrl: "blob:preview",
    } as never);

    const { findByRole, getByRole, queryByRole } = renderPanel();
    (await findByRole("button", { name: /Save…/ })).click();

    // The master-resume note renders once the careerProfile query resolves.
    await findByRole("button", { name: /Save as new/ });
    expect(queryByRole("button", { name: /Update my resume/ })).toBeNull();
    expect(getByRole("button", { name: /Save as new/ })).not.toBeNull();
  });

  it("still offers 'Update my resume' when the open resume is not the master", async () => {
    getCareerProfile.mockResolvedValue({ master_resume_id: "some-other-resume" });
    useResumeStore.getState().setResume("resume-1", changedOriginal, "ats_clean");
    useTailoringStore.setState({
      pendingContent: changedPending,
      mergedContent: changedPending,
      previewPdfUrl: "blob:preview",
    } as never);

    const { findByRole } = renderPanel();
    (await findByRole("button", { name: /Save…/ })).click();
    await findByRole("button", { name: /Update my resume/ });
  });
});
