// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    rewriteBullet: vi.fn(),
    updateResume: vi.fn(async () => ({})),
    getResume: vi.fn(),
    projectScore: vi.fn(async () => ({ projected_score: 0 })),
  },
}));

import StudioReviewPage from "../app/(builder)/studio/[resumeId]/review/page";
import { apiClient } from "@/lib/api-client";
import { useResumeStore } from "../stores/resume-store";
import { useTailoringStore } from "../stores/tailoring-store";

const ORIGINAL = {
  contact: { name: "Jane" },
  summary: "Did things.",
  experience: [{ title: "Engineer", company: "Acme", bullets: ["Managed the deploy process."] }],
  education: [],
  skills: ["Python"],
};
const TAILORED = {
  ...ORIGINAL,
  summary: "Shipped things.",
  experience: [{ title: "Engineer", company: "Acme", bullets: ["Owned end-to-end CI/CD pipelines."] }],
};

async function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={qc}>
        <StudioReviewPage params={Promise.resolve({ resumeId: "r1" })} />
      </QueryClientProvider>,
    );
  });
  return result;
}

describe("Studio review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
    useResumeStore.setState({ resumeId: "r1", content: ORIGINAL } as never);
    useTailoringStore.setState({
      jdId: "jd1",
      jdText: "Senior engineer",
      pendingContent: null,
      isLoading: false,
      error: null,
      runTailoring: vi.fn(async () => {}),
    } as never);
  });

  it("runs tailoring on arrival so the JD path needs only one click", async () => {
    await renderPage();
    await waitFor(() =>
      expect(useTailoringStore.getState().runTailoring).toHaveBeenCalledWith("r1"),
    );
  });

  it("does not re-run tailoring when a review is already in progress", async () => {
    useTailoringStore.setState({ pendingContent: TAILORED } as never);
    await renderPage();
    expect(useTailoringStore.getState().runTailoring).not.toHaveBeenCalled();
  });

  // Supersedes an earlier redirect-to-Builder guess. This route owns the
  // whole of tailoring, so with no JD yet it is the place you paste one --
  // which is also what restores Path B, whose only entry point (SourcePanel)
  // was orphaned by the same deletion that took the review.
  it("offers the paste form when no JD has been chosen yet", async () => {
    useTailoringStore.setState({ jdId: null, jdText: "" } as never);
    await renderPage();
    expect(screen.getByText(/tailor to a job description/i)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not spend a credit before a JD exists", async () => {
    useTailoringStore.setState({ jdId: null, jdText: "" } as never);
    await renderPage();
    expect(useTailoringStore.getState().runTailoring).not.toHaveBeenCalled();
  });

  it("lists the rewritten bullets to accept or reject", async () => {
    useTailoringStore.setState({ pendingContent: TAILORED } as never);
    await renderPage();
    await waitFor(() => expect(screen.getByText(/CI\/CD pipelines/i)).toBeTruthy());
  });

  it("offers the skills to add", async () => {
    useTailoringStore.setState({
      pendingContent: TAILORED,
      suggestedSkills: ["Kubernetes"],
    } as never);
    await renderPage();
    await waitFor(() => expect(screen.getByText(/Kubernetes/i)).toBeTruthy());
  });

  it("goes straight to the studio when the review is applied", async () => {
    useTailoringStore.setState({ pendingContent: TAILORED } as never);
    await renderPage();
    const apply = await waitFor(() => screen.getByRole("button", { name: /apply & preview/i }));
    fireEvent.click(apply);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio/r1/preview"));
  });

  // The JD Analyzer never loads the résumé into the store, so this page is
  // usually the first to need it. Without it there is nothing to diff the
  // tailored bullets against and the review comes up empty.
  it("loads the résumé itself when arriving from the analyzer with a cold store", async () => {
    useResumeStore.getState().resetStore();
    vi.mocked(apiClient.getResume).mockResolvedValue({
      id: "r1", content: ORIGINAL, template_id: "ats_clean",
    } as never);
    useTailoringStore.setState({ pendingContent: TAILORED } as never);
    await renderPage();
    await waitFor(() => expect(screen.getByText(/CI\/CD pipelines/i)).toBeTruthy());
    expect(useResumeStore.getState().content).toEqual(ORIGINAL);
  });

  it("waits for the résumé before tailoring, so every rewrite is seeded as a decision", async () => {
    useResumeStore.getState().resetStore();
    let resolve!: (r: unknown) => void;
    vi.mocked(apiClient.getResume).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    await renderPage();
    expect(useTailoringStore.getState().runTailoring).not.toHaveBeenCalled();
    await act(async () => resolve({ id: "r1", content: ORIGINAL, template_id: "ats_clean" }));
    await waitFor(() =>
      expect(useTailoringStore.getState().runTailoring).toHaveBeenCalledWith("r1"),
    );
  });

  it("writes the accepted rewrites into the résumé before opening the studio", async () => {
    useTailoringStore.setState({ pendingContent: TAILORED, bulletDecisions: {} } as never);
    await renderPage();
    const apply = await waitFor(() => screen.getByRole("button", { name: /apply & preview/i }));
    fireEvent.click(apply);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio/r1/preview"));
    expect(useResumeStore.getState().content?.experience[0].bullets).toEqual([
      "Owned end-to-end CI/CD pipelines.",
    ]);
  });

  it("keeps the original text of a rejected rewrite", async () => {
    useTailoringStore.setState({
      pendingContent: TAILORED,
      bulletDecisions: { exp0_b0: "reject" },
    } as never);
    await renderPage();
    const apply = await waitFor(() => screen.getByRole("button", { name: /apply & preview/i }));
    fireEvent.click(apply);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(useResumeStore.getState().content?.experience[0].bullets).toEqual([
      "Managed the deploy process.",
    ]);
  });

  // An empty rewrite list said "already well-aligned" next to a 40% score.
  it("does not call the résumé a good fit just because nothing was rewritten", async () => {
    useTailoringStore.setState({ pendingContent: ORIGINAL, atsScore: 42 } as never);
    await renderPage();
    await waitFor(() => expect(screen.getByText(/no bullets were rewritten/i)).toBeTruthy());
    expect(screen.queryByText(/well-aligned/i)).toBeNull();
  });

  it("lists the fixes still off, best first, when the score is under 80", async () => {
    const fix = (id: string, text: string, score_delta: number) => ({
      id, type: "skill", gap: text, importance: "high", grounded: true, text,
      experience_index: null, score_delta, default_accept: false,
    });
    useTailoringStore.setState({
      pendingContent: TAILORED,
      sessionId: "s1",
      projectedAtsScore: 55,
      atsFixes: [fix("skill:rust", "Rust", 4), fix("skill:go", "Go", 9), fix("skill:k8s", "Kubernetes", 6)],
      bulletDecisions: { "fix:skill:k8s": "accept" },
    } as never);
    await renderPage();
    const reach = await waitFor(() => screen.getByRole("region", { name: /reach 80/i }));
    const items = Array.from(reach.querySelectorAll("li")).map((li) => li.textContent);
    expect(items[0]).toMatch(/\+9.*Go/);
    expect(items[1]).toMatch(/\+4.*Rust/);
    expect(items.some((t) => /Kubernetes/.test(t ?? ""))).toBe(false);
    fireEvent.click(reach.querySelectorAll("button")[0]);
    expect(useTailoringStore.getState().bulletDecisions["fix:skill:go"]).toBe("accept");
  });

  it("goes back to the analyzer, not to the resume list", async () => {
    useTailoringStore.setState({ pendingContent: TAILORED } as never);
    await renderPage();
    const back = await waitFor(() => screen.getByRole("button", { name: /back to analyzer/i }));
    fireEvent.click(back);
    expect(push).toHaveBeenCalledWith("/jd/jd1");
  });
});
