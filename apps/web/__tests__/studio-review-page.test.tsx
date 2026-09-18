// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/lib/api-client", () => ({
  apiClient: { rewriteBullet: vi.fn(), updateResume: vi.fn(async () => ({})) },
}));

import StudioReviewPage from "../app/(builder)/studio/[resumeId]/review/page";
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

  it("goes back to the analyzer, not to the resume list", async () => {
    useTailoringStore.setState({ pendingContent: TAILORED } as never);
    await renderPage();
    const back = await waitFor(() => screen.getByRole("button", { name: /back to analyzer/i }));
    fireEvent.click(back);
    expect(push).toHaveBeenCalledWith("/jd/jd1");
  });
});
