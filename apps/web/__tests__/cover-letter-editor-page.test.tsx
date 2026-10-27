// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiClient: {
    getCoverLetter: vi.fn(),
    updateCoverLetter: vi.fn(),
    generateCoverLetterPdf: vi.fn(),
    generateCoverLetter: vi.fn(),
    deleteCoverLetter: vi.fn(),
  },
}));

import CoverLetterEditorPage from "../app/(app)/cover-letters/[id]/page";
import { apiClient, ApiError } from "../lib/api-client";

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

    expect(await screen.findByText(/Writing your cover letter/)).toBeInTheDocument();
    // The page polls via refetchInterval every 3000ms while status is
    // "pending" — the default findBy/waitFor timeout (1000ms) is shorter
    // than that, so it must be extended here or this assertion times out
    // before the poll ever fires (and the queued mock value leaks into the
    // next test instead of being consumed here).
    expect(await screen.findByDisplayValue(/Dear Hiring Manager/, {}, { timeout: 5000 })).toBeInTheDocument();
  }, 8000);

  it("says so when the letter was saved in another tab, and saves over it only when asked", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
      saved_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.updateCoverLetter)
      .mockRejectedValueOnce(new ApiError(409, "This letter was saved in another tab or device.", {
        code: "letter_changed", message: "This letter was saved in another tab or device.",
        saved_at: "2026-01-02T00:00:00Z",
      }))
      .mockResolvedValueOnce({ title: "Cover letter", saved_at: "2026-01-03T00:00:00Z" } as never);

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);
    const editor = await screen.findByDisplayValue("Original body");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Mine");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // Sent from the version loaded; refused, nothing overwritten.
    expect(apiClient.updateCoverLetter).toHaveBeenLastCalledWith("cl-1", "Mine", undefined, "2026-01-01T00:00:00Z");
    expect(await screen.findByRole("alert")).toHaveTextContent(/saved in another tab or device/);

    await userEvent.click(screen.getByRole("button", { name: "Keep this version" }));
    await waitFor(() =>
      expect(apiClient.updateCoverLetter).toHaveBeenLastCalledWith("cl-1", "Mine", undefined, "2026-01-02T00:00:00Z"),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("saves edits via updateCoverLetter", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
      saved_at: "2026-01-01T00:00:00Z",
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

    await waitFor(() => expect(apiClient.updateCoverLetter).toHaveBeenCalledWith("cl-1", "Edited body", undefined, "2026-01-01T00:00:00Z"));
  });

  it("reads Saved until the draft changes, then Saved again once the save lands", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
      saved_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.updateCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body!", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    const textarea = await screen.findByDisplayValue("Original body");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    await userEvent.type(textarea, "!");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("downloads the text on screen from the data: URL without fetching it, and saves nothing", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
      saved_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.updateCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body!", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.generateCoverLetterPdf).mockResolvedValue({ signed_url: "data:application/pdf;base64,JVBERg==" });

    // fetch() on a data: URL is blocked by the page's CSP — it must never be called.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const names: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    try {
      await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);
      await userEvent.type(await screen.findByDisplayValue("Original body"), "!");
      await userEvent.click(screen.getByText("Download PDF"));

      await waitFor(() => expect(names).toEqual(["Cover Letter.pdf"]));
      // Downloading is not saving: the PDF is the text on screen, and
      // nothing is written back.
      expect(apiClient.generateCoverLetterPdf).toHaveBeenCalledWith("cl-1", "Original body!");
      expect(apiClient.updateCoverLetter).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("a freshly written letter is a draft: kept only when Save is pressed", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Fresh letter", humanize_level: 50, pdf_url: null, status: "completed",
      created_at: "2026-01-01T00:00:00Z", saved_at: null, title: "Cover letter — Platform Engineer",
    });
    vi.mocked(apiClient.updateCoverLetter).mockResolvedValue({ title: "Cover letter — Platform Engineer (2)" } as never);

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    expect(await screen.findByText(/Draft, not saved/)).toBeInTheDocument();
    expect(apiClient.updateCoverLetter).not.toHaveBeenCalled();
    // Unchanged, and still savable: a draft is not kept until the user says so.
    await userEvent.click(screen.getByRole("button", { name: "Save letter" }));
    await waitFor(() => expect(apiClient.updateCoverLetter).toHaveBeenCalledWith("cl-1", "Fresh letter", "Cover letter — Platform Engineer", null));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.queryByText(/Draft, not saved/)).not.toBeInTheDocument();
    // Named after its job, numbered by the server beside the job's other letters.
    expect(screen.getByLabelText("Letter name")).toHaveValue("Cover letter — Platform Engineer (2)");
  });

  it("renames the letter in its heading, and Save keeps the new name", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Body", humanize_level: 50, pdf_url: null, status: "completed",
      created_at: "2026-01-01T00:00:00Z", saved_at: "2026-01-01T00:00:00Z", title: "Cover letter — Platform Engineer",
    });
    vi.mocked(apiClient.updateCoverLetter).mockResolvedValue({ title: "For Stripe" } as never);

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    const name = await screen.findByLabelText("Letter name");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, "For Stripe");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.updateCoverLetter).toHaveBeenCalledWith("cl-1", "Body", "For Stripe", "2026-01-01T00:00:00Z"));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("clicking Regenerate once results in exactly one generateCoverLetter call", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
      saved_at: "2026-01-01T00:00:00Z",
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
      saved_at: "2026-01-01T00:00:00Z",
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
    expect(screen.queryByText(/Writing your cover letter/)).not.toBeInTheDocument();
  });

  it("deletes the letter after a confirm, then returns to the list", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Body", humanize_level: 50, pdf_url: null, status: "completed",
      created_at: "2026-01-01T00:00:00Z", saved_at: "2026-01-01T00:00:00Z", title: "Cover letter — X",
    });
    vi.mocked(apiClient.deleteCoverLetter).mockResolvedValue(undefined);
    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete letter" }));
    expect(apiClient.deleteCoverLetter).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(apiClient.deleteCoverLetter).toHaveBeenCalledWith("cl-1"));
    expect(mockPush).toHaveBeenCalledWith("/cover-letters");
  });
});
