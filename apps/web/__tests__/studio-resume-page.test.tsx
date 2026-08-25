// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

// EditorPanel/PreviewPanel pull in the tailoring store, AI calls, etc. —
// irrelevant to what this file tests (whether the page fetches and applies
// an already-generated PDF on open), so they're stubbed to keep the render
// cheap and this test focused on the page's own effect wiring.
vi.mock("@/components/resume/EditorPanel", () => ({
  EditorPanel: () => null,
}));
vi.mock("@/components/resume/PreviewPanel", () => ({
  PreviewPanel: () => null,
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getResume: vi.fn(),
    getLatestResumePdf: vi.fn(),
    updateResume: vi.fn().mockResolvedValue({}),
  },
}));

import StudioResumePage from "../app/(app)/studio/[resumeId]/page";
import { apiClient } from "../lib/api-client";
import { useResumeStore } from "../stores/resume-store";
import { useTailoringStore } from "../stores/tailoring-store";

const SAMPLE_CONTENT = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [],
  education: [],
  skills: [],
};

function makeResume(overrides: Record<string, unknown> = {}) {
  return {
    id: "resume-1",
    user_id: "user-1",
    title: "My Resume",
    template_id: "ats_clean",
    content: SAMPLE_CONTENT,
    line_spacing: 1.25,
    paragraph_spacing: 12,
    pdf_url: null,
    original_file_name: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
}

describe("Studio resume editor page — loading an already-generated PDF on open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
  });

  it("fetches and shows the last-generated PDF for a resume that already has one — no 'Generate PDF' click needed", async () => {
    vi.mocked(apiClient.getResume).mockResolvedValue(
      makeResume({ pdf_url: "resumes/user-1/resume-1.pdf" }) as any
    );
    vi.mocked(apiClient.getLatestResumePdf).mockResolvedValue({
      signed_url: "https://signed.example/resume-1.pdf",
      file_name: null,
    });

    await renderWithQueryClient(
      <StudioResumePage params={Promise.resolve({ resumeId: "resume-1" })} />
    );

    await waitFor(() => expect(apiClient.getLatestResumePdf).toHaveBeenCalledWith("resume-1"));
    await waitFor(() =>
      expect(useResumeStore.getState().pdfSignedUrl).toBe("https://signed.example/resume-1.pdf")
    );
  });

  it("does not call getLatestResumePdf for a resume that has never had a PDF generated", async () => {
    vi.mocked(apiClient.getResume).mockResolvedValue(makeResume({ pdf_url: null }) as any);

    await renderWithQueryClient(
      <StudioResumePage params={Promise.resolve({ resumeId: "resume-1" })} />
    );

    await waitFor(() => expect(useResumeStore.getState().resumeId).toBe("resume-1"));
    expect(apiClient.getLatestResumePdf).not.toHaveBeenCalled();
    expect(useResumeStore.getState().pdfSignedUrl).toBeNull();
  });

  it("does not overwrite an already-loaded preview (e.g. from a just-completed AI tailoring) by re-fetching", async () => {
    // Simulate arriving here right after tailoring already wrote a fresh
    // preview into the store, matching the guard the existing setResume
    // effect already has for this exact scenario.
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    useResumeStore.getState().setPdfSignedUrl("https://example.com/tailored-preview.pdf");

    vi.mocked(apiClient.getResume).mockResolvedValue(
      makeResume({ pdf_url: "resumes/user-1/resume-1.pdf" }) as any
    );

    await renderWithQueryClient(
      <StudioResumePage params={Promise.resolve({ resumeId: "resume-1" })} />
    );

    // Give any stray effects a tick to (not) fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(apiClient.getLatestResumePdf).not.toHaveBeenCalled();
    expect(useResumeStore.getState().pdfSignedUrl).toBe("https://example.com/tailored-preview.pdf");
  });
});
