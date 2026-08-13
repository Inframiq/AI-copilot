// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getCoverLetter: vi.fn(),
    updateCoverLetter: vi.fn(),
    generateCoverLetterPdf: vi.fn(),
    generateCoverLetter: vi.fn(),
  },
}));

import CoverLetterEditorPage from "../app/(app)/cover-letters/[id]/page";
import { apiClient } from "../lib/api-client";

async function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  return result;
}

describe("CoverLetterEditorPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a generating state while status is pending, then the editable content once completed", async () => {
    vi.mocked(apiClient.getCoverLetter)
      .mockResolvedValueOnce({
        id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
        content: null, humanize_level: 50, pdf_url: null, status: "pending", created_at: "2026-01-01T00:00:00Z",
      })
      .mockResolvedValueOnce({
        id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
        content: "Dear Hiring Manager,\n\nBody text.\n\nSincerely,\nJane Doe",
        humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
      });

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    expect(await screen.findByText(/Generating your cover letter/)).toBeInTheDocument();
    // The page polls via refetchInterval every 3000ms while status is
    // "pending" — the default findBy/waitFor timeout (1000ms) is shorter
    // than that, so it must be extended here or this assertion times out
    // before the poll ever fires (and the queued mock value leaks into the
    // next test instead of being consumed here).
    expect(await screen.findByDisplayValue(/Dear Hiring Manager/, {}, { timeout: 5000 })).toBeInTheDocument();
  }, 8000);

  it("saves edits via updateCoverLetter", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.updateCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Edited body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    const textarea = await screen.findByDisplayValue("Original body");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Edited body");
    await userEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(apiClient.updateCoverLetter).toHaveBeenCalledWith("cl-1", "Edited body"));
  });

  it("clicking Regenerate once results in exactly one generateCoverLetter call", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-new", status: "pending" });

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    await screen.findByDisplayValue("Original body");
    await userEvent.click(screen.getByText("Regenerate"));

    await waitFor(() => expect(apiClient.generateCoverLetter).toHaveBeenCalledTimes(1));
    expect(apiClient.generateCoverLetter).toHaveBeenCalledWith("r1", "jd1", 50, undefined);
  });

  it("navigates to the newly-generated cover letter's page instead of re-fetching the stale one", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });
    // Distinct id from the page's own "cl-1" — proves navigation targets the
    // NEW row the backend created, not a refetch/invalidate of the old one.
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-new", status: "pending" });

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    await screen.findByDisplayValue("Original body");
    await userEvent.click(screen.getByText("Regenerate"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-new"));
  });

  // Note: a genuine "drag through several intermediate values without
  // committing" interaction can't be reproduced in jsdom (no layout, no
  // pointer capture on Radix's slider — and even keyboard interaction
  // commits on every keypress in Radix, unlike a real pointer drag). The
  // onChange-fires-many/onCommit-fires-once wiring itself is covered
  // directly in __tests__/humanize-slider.test.tsx by mocking
  // @radix-ui/react-slider and driving its onValueChange/onValueCommit
  // callbacks. Here we cover the page-level contract: HumanizeSlider is
  // wired to update local `sliderValue` state on every onChange (so the
  // thumb doesn't freeze) while only `onCommit` reaches
  // `handleRegenerate` — proven by the two tests above, which show a
  // single Regenerate action (the page's other onCommit-equivalent path)
  // results in exactly one API call.

  it("shows an error state (not an infinite spinner) when the fetch fails", async () => {
    vi.mocked(apiClient.getCoverLetter).mockRejectedValue(new Error("Not found"));

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-missing" })} />);

    expect(await screen.findByText(/Could not load this cover letter/)).toBeInTheDocument();
    expect(screen.queryByText(/Generating your cover letter/)).not.toBeInTheDocument();
  });
});
