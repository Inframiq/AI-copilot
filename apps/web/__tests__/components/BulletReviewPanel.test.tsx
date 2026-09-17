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

  it("shows the projected score as the current figure in the review header", () => {
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

    // Rendered by ScoreLift now, not as a caption — the projected score wins
    // over atsScore because it describes the resume actually on screen.
    const { getByTestId } = renderPanel();
    expect(getByTestId("score-current").textContent).toContain("72");
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

  it("shows the 'shorter than a page' advisory when the tailored preview came back underfilled", () => {
    useResumeStore.getState().setResume("resume-1", changedOriginal, "ats_clean");
    useTailoringStore.setState({
      pendingContent: changedPending,
      mergedContent: changedPending,
      previewPdfUrl: "blob:preview",
    } as never);
    useResumeStore.getState().setPreviewUnderfilled(true);

    const { getByText } = renderPanel();
    expect(getByText(/shorter than a full page/i)).toBeTruthy();
  });

  it("does not show the advisory when the tailored preview fills the page", () => {
    useResumeStore.getState().setResume("resume-1", changedOriginal, "ats_clean");
    useTailoringStore.setState({
      pendingContent: changedPending,
      mergedContent: changedPending,
      previewPdfUrl: "blob:preview",
    } as never);
    useResumeStore.getState().setPreviewUnderfilled(false);

    const { queryByText } = renderPanel();
    expect(queryByText(/shorter than a full page/i)).toBeNull();
  });
});

describe("BulletReviewPanel fact-lock notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue(null);
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
  });
  afterEach(() => cleanup());

  const content = {
    contact: { name: "Jane", email: "jane@example.com" },
    experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Built checkout."] }],
    education: [],
    skills: [],
  };

  it("tells the user a bullet was kept unchanged and why", () => {
    useResumeStore.getState().setResume("resume-1", content as never, "ats_clean");
    useTailoringStore.setState({
      pendingContent: content,
      revertedBullets: [{
        bullet_id: "exp0_b0",
        reasons: ["invented metric(s) not in the original bullet: 2"],
        original_text: "Built checkout.",
        rejected_text: "Built checkout for 2M users.",
      }],
    } as never);

    const { getByTestId } = renderPanel();
    const notice = getByTestId("fact-lock-notice");
    expect(notice.textContent).toContain("invented metric");
  });

  it("renders nothing when no rewrite was rejected", () => {
    useResumeStore.getState().setResume("resume-1", content as never, "ats_clean");
    useTailoringStore.setState({ pendingContent: content, revertedBullets: [] } as never);

    const { queryByTestId } = renderPanel();
    expect(queryByTestId("fact-lock-notice")).toBeNull();
  });
});

describe("BulletReviewPanel bullet diff and rationale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue(null);
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
  });
  afterEach(() => cleanup());

  const original = {
    contact: { name: "Jane", email: "jane@example.com" },
    experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Built the checkout flow"] }],
    education: [],
    skills: [],
  };
  const pending = {
    ...original,
    experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Engineered the checkout pipeline"] }],
  };

  function setup(extra: Record<string, unknown> = {}) {
    useResumeStore.getState().setResume("resume-1", original as never, "ats_clean");
    useTailoringStore.setState({ pendingContent: pending, ...extra } as never);
    return renderPanel();
  }

  /** All text marked as changed on one side, joined — "the words the rewrite
   * added/removed", which may be several runs within the bullet. */
  const marked = (q: ReturnType<typeof renderPanel>["getAllByTestId"], id: string) =>
    q(id).map((el) => el.textContent).join(" ");

  it("highlights the words the rewrite added", () => {
    const { getAllByTestId } = setup();
    const added = marked(getAllByTestId, "bullet-diff-added-exp0_b0");
    expect(added).toContain("Engineered");
    expect(added).toContain("pipeline");
  });

  it("highlights the words the rewrite removed", () => {
    const { getAllByTestId } = setup();
    const removed = marked(getAllByTestId, "bullet-diff-removed-exp0_b0");
    expect(removed).toContain("Built");
    expect(removed).toContain("flow");
  });

  it("does not mark unchanged words as changed", () => {
    const { getAllByTestId } = setup();
    expect(marked(getAllByTestId, "bullet-diff-added-exp0_b0")).not.toContain("checkout");
    expect(marked(getAllByTestId, "bullet-diff-removed-exp0_b0")).not.toContain("checkout");
  });

  it("names the JD responsibility the rewrite demonstrates", () => {
    const { getByTestId } = setup({
      bulletRationale: {
        exp0_b0: { responsibility: "own end-to-end delivery of the checkout pipeline", keywords: [] },
      },
    });
    expect(getByTestId("bullet-rationale-exp0_b0").textContent)
      .toContain("own end-to-end delivery of the checkout pipeline");
  });

  it("lists the JD keywords woven into the bullet", () => {
    const { getByTestId } = setup({
      bulletRationale: { exp0_b0: { responsibility: "", keywords: ["CI/CD", "checkout pipeline"] } },
    });
    const el = getByTestId("bullet-rationale-exp0_b0");
    expect(el.textContent).toContain("CI/CD");
    expect(el.textContent).toContain("checkout pipeline");
  });

  it("renders no rationale block when the session carries none", () => {
    const { queryByTestId } = setup();
    expect(queryByTestId("bullet-rationale-exp0_b0")).toBeNull();
  });
});

describe("BulletReviewPanel score lift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue(null);
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
  });
  afterEach(() => cleanup());

  const content = {
    contact: { name: "Jane", email: "jane@example.com" },
    experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Built checkout."] }],
    education: [],
    skills: [],
  };

  function setup(extra: Record<string, unknown>) {
    useResumeStore.getState().setResume("resume-1", content as never, "ats_clean");
    useTailoringStore.setState({ pendingContent: content, ...extra } as never);
    return renderPanel();
  }

  it("shows the lift tailoring produced, not just the final score", () => {
    const { getByTestId } = setup({ atsScore: 81, atsScoreBefore: 62 });
    const el = getByTestId("score-lift");
    expect(el.textContent).toContain("62");
    expect(el.textContent).toContain("81");
  });

  it("labels the gain so the number reads as a result", () => {
    const { getByTestId } = setup({ atsScore: 81, atsScoreBefore: 62 });
    expect(getByTestId("score-lift").textContent).toContain("+19");
  });

  // score-current is always the figure describing the resume on screen;
  // score-lift is the before->after pair, which only exists once a
  // before-score has been recorded.
  it("shows the score alone when no before-score was recorded", () => {
    const { queryByTestId, getByTestId } = setup({ atsScore: 81, atsScoreBefore: null });
    expect(queryByTestId("score-lift")).toBeNull();
    expect(getByTestId("score-current").textContent).toContain("81");
  });

  it("renders nothing at all before a score exists", () => {
    const { queryByTestId } = setup({ atsScore: null, atsScoreBefore: null });
    expect(queryByTestId("score-current")).toBeNull();
  });

  it("prefers the projected score as the current figure once fixes are chosen", () => {
    const { getByTestId } = setup({ atsScore: 81, atsScoreBefore: 62, projectedAtsScore: 88 });
    expect(getByTestId("score-current").textContent).toContain("88");
  });
});
