// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getResume: vi.fn(async () => ({
      id: "r1", content: { contact: { name: "Jane" }, summary: "S", experience: [], education: [], skills: [] },
      template_id: "ats_modern", line_spacing: 1.3, paragraph_spacing: 10,
      font_choice: "serif", accent_color: "#112233",
    })),
  },
}));

import { apiClient } from "../lib/api-client";
import { useHydratedResume } from "../lib/use-hydrated-resume";
import { useResumeStore } from "../stores/resume-store";

function Probe({ id }: { id: string }) {
  const { isLoading, isError } = useHydratedResume(id);
  return <div data-testid="state">{isLoading ? "loading" : isError ? "error" : "ready"}</div>;
}

async function mount(id = "r1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let r!: ReturnType<typeof render>;
  await act(async () => {
    r = render(<QueryClientProvider client={qc}><Probe id={id} /></QueryClientProvider>);
  });
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  useResumeStore.getState().resetStore();
});

describe("useHydratedResume", () => {
  // The Studio read the store but never filled it, so a refresh — or opening
  // the preview link directly — left it empty and the page said there was
  // nothing to preview. Going back to the Builder and forward again fixed it,
  // because the Builder is what fetched.
  it("fetches the résumé when the store is empty", async () => {
    await mount();
    await waitFor(() => expect(apiClient.getResume).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(useResumeStore.getState().content?.contact.name).toBe("Jane"));
  });

  it("carries the template and spacing across, not just the content", async () => {
    await mount();
    await waitFor(() => expect(useResumeStore.getState().templateId).toBe("ats_modern"));
    expect(useResumeStore.getState().lineSpacing).toBe(1.3);
    expect(useResumeStore.getState().accentColor).toBe("#112233");
  });

  it("leaves a résumé the store already holds alone", async () => {
    // Re-applying would blow away unsaved edits and the tailoring the review
    // just wrote — the same reason the Builder guards on the id.
    useResumeStore.setState({ resumeId: "r1", content: { summary: "edited" } } as never);
    await mount();
    await waitFor(() => expect(useResumeStore.getState().content?.summary).toBe("edited"));
  });

  it("reports a failure instead of looking empty forever", async () => {
    vi.mocked(apiClient.getResume).mockRejectedValueOnce(new Error("nope"));
    const { getByTestId } = await mount();
    await waitFor(() => expect(getByTestId("state").textContent).toBe("error"));
  });

  it("fetches when the store knows the id but holds no content", () => {
    // The JD path reaches the review with the id set and nothing behind it.
    useResumeStore.setState({ resumeId: "r1", content: null } as never);
    return mount().then(async () => {
      await waitFor(() => expect(apiClient.getResume).toHaveBeenCalledWith("r1"));
    });
  });

  it("does not fetch a résumé that has unsaved edits in the store", async () => {
    useResumeStore.setState({ resumeId: "r1", content: { summary: "x" }, isDirty: true } as never);
    await mount();
    expect(apiClient.getResume).not.toHaveBeenCalled();
  });

  // The Profile saves an uploaded résumé over the master under the same id.
  // The Builder held the copy from before and never looked again, so the
  // new summary showed in the Profile and the old one in the Builder.
  it("takes a newer saved copy over a clean one in the store", async () => {
    useResumeStore.setState({
      resumeId: "r1", content: { summary: "old" }, updatedAt: "2026-11-01T00:00:00Z",
    } as never);
    vi.mocked(apiClient.getResume).mockResolvedValueOnce({
      id: "r1", content: { contact: { name: "Jane" }, summary: "new", experience: [], education: [], skills: [] },
      template_id: "ats_clean", updated_at: "2026-11-28T00:00:00Z",
    } as never);
    await mount();
    await waitFor(() => expect(useResumeStore.getState().content?.summary).toBe("new"));
    expect(useResumeStore.getState().updatedAt).toBe("2026-11-28T00:00:00Z");
  });

  it("keeps the store's copy when the saved one is not newer", async () => {
    useResumeStore.setState({
      resumeId: "r1", content: { summary: "mine" }, updatedAt: "2026-11-28T00:00:00Z",
    } as never);
    vi.mocked(apiClient.getResume).mockResolvedValueOnce({
      id: "r1", content: { summary: "older" }, template_id: "ats_clean", updated_at: "2026-11-01T00:00:00Z",
    } as never);
    await mount();
    await waitFor(() => expect(apiClient.getResume).toHaveBeenCalled());
    expect(useResumeStore.getState().content?.summary).toBe("mine");
  });

  it("never replaces a tailored draft with the saved copy", async () => {
    useResumeStore.setState({
      resumeId: "r1", content: { summary: "draft" }, draftJdId: "jd1", updatedAt: "2026-11-01T00:00:00Z",
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function DraftProbe() { useHydratedResume("r1", { allowDraft: true }); return null; }
    await act(async () => { render(<QueryClientProvider client={qc}><DraftProbe /></QueryClientProvider>); });
    expect(apiClient.getResume).not.toHaveBeenCalled();
    expect(useResumeStore.getState().content?.summary).toBe("draft");
  });
});

