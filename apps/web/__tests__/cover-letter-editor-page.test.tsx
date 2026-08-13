// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
});
