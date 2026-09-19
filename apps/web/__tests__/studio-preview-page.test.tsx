// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiClient: {
    renderResumeHtml: vi.fn(async () => ({
      html: '<p data-field="summary">Old summary.</p>',
    })),
    generatePdf: vi.fn(async () => ({ signed_url: "u", underfilled: false })),
    getResume: vi.fn(async () => ({
      id: "r1", content: { contact: {}, summary: "Fetched.", experience: [], education: [], skills: [] },
      template_id: "ats_clean", line_spacing: 1.25, paragraph_spacing: 12,
      font_choice: "sans", accent_color: null,
    })),
  },
}));

import StudioPreviewPage from "../app/(builder)/studio/[resumeId]/preview/page";
import { useResumeStore } from "../stores/resume-store";
import { useTailoringStore } from "../stores/tailoring-store";
import { apiClient } from "../lib/api-client";

// The page reads route params with use(), which suspends. Flushing inside
// act() is how the sibling route test handles the same thing.
async function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={qc}>
        <StudioPreviewPage params={Promise.resolve({ resumeId: "r1" })} />
      </QueryClientProvider>,
    );
  });
  return result;
}

describe("Studio preview page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
    useResumeStore.setState({
      resumeId: "r1",
      content: {
        contact: {}, summary: "Old summary.", experience: [], education: [], skills: [],
      },
    } as never);
  });

  it("renders the document from the server", async () => {
    await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalled());
  });

  it("goes back to the builder without losing state", async () => {
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /back to builder/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to builder/i }));
    expect(push).toHaveBeenCalledWith("/studio/r1");
  });

  it("writes an inline edit back to the store", async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalled());
    const host = await waitFor(() => {
      const el = container.querySelector("[data-canvas]") as HTMLElement;
      if (!el?.shadowRoot?.querySelector("[data-field]")) throw new Error("not yet");
      return el;
    });
    const node = host.shadowRoot!.querySelector("[data-field]") as HTMLElement;
    node.textContent = "New summary.";
    fireEvent.blur(node);
    await waitFor(() =>
      expect(useResumeStore.getState().content?.summary).toBe("New summary."),
    );
  });

  it("exports through the existing PDF path", async () => {
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /export pdf/i }));
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    await waitFor(() => expect(apiClient.generatePdf).toHaveBeenCalled());
  });

  // Regression: Export generated the PDF and threw the link away — the
  // button spun, then nothing downloaded. The deleted workbench used to
  // fetch the file and save it; that step never made it to this page.
  it("downloads the PDF, named after the candidate", async () => {
    useResumeStore.setState({
      content: { contact: { name: "Jane Doe" }, summary: "", experience: [], education: [], skills: [] },
    } as never);
    const fetchMock = vi.fn(async () => new Response("%PDF", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const createUrl = vi.fn(() => "blob:resume");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    try {
      await renderPage();
      await waitFor(() => screen.getByRole("button", { name: /export pdf/i }));
      fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith("u");
      expect(downloads).toEqual(["Jane Doe - Resume.pdf"]);
      expect(revokeUrl).toHaveBeenCalledWith("blob:resume");
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("saves pending edits before exporting, so the PDF matches the page", async () => {
    const order: string[] = [];
    const saveNow = vi.fn(async () => { order.push("save"); });
    useResumeStore.setState({ saveNow, isDirty: true } as never);
    vi.mocked(apiClient.generatePdf).mockImplementationOnce(async () => {
      order.push("pdf");
      return { signed_url: "u", underfilled: false };
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("%PDF")));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await renderPage();
      await waitFor(() => screen.getByRole("button", { name: /export pdf/i }));
      fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
      await waitFor(() => expect(order).toEqual(["save", "pdf"]));
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("starts in edit mode so the document is immediately editable", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /edit/i }).getAttribute("aria-selected")).toBe("true"),
    );
  });

  it("shows a loading state while the document renders", async () => {
    vi.mocked(apiClient.renderResumeHtml).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    await renderPage();
    expect(screen.getByText(/laying out your résumé/i)).toBeTruthy();
  });

  it("surfaces a render failure instead of a blank page", async () => {
    vi.mocked(apiClient.renderResumeHtml).mockRejectedValueOnce(new Error("boom"));
    await renderPage();
    await waitFor(() => screen.getByText(/couldn.t render/i));
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("recovers when the retry succeeds", async () => {
    vi.mocked(apiClient.renderResumeHtml).mockRejectedValueOnce(new Error("boom"));
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /try again/i }));
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.queryByText(/couldn.t render/i)).toBeNull());
  });

  it("says so when the résumé loads but has nothing in it", async () => {
    // A null store no longer means "nothing to preview" — it means "not
    // fetched yet", and the page fetches. The empty notice is now for a
    // résumé that really is empty.
    useResumeStore.getState().resetStore();
    vi.mocked(apiClient.getResume).mockResolvedValueOnce({
      id: "r1", content: null, template_id: "ats_clean", line_spacing: 1.25,
      paragraph_spacing: 12, font_choice: "sans", accent_color: null,
    } as never);
    await renderPage();
    await waitFor(() => expect(screen.getByText(/nothing to preview/i)).toBeTruthy());
    expect(apiClient.renderResumeHtml).not.toHaveBeenCalled();
  });

  it("surfaces an export failure rather than swallowing it", async () => {
    vi.mocked(apiClient.generatePdf).mockRejectedValueOnce(new Error("no credits"));
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /export pdf/i }));
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert").textContent).toMatch(/no credits/i);
    // and the button comes back, so the export is retryable
    expect(
      screen.getByRole("button", { name: /export pdf/i }).hasAttribute("disabled"),
    ).toBe(false);
  });

  // Back is path-specific: arriving from the JD Analyzer, the Builder's six
  // sections were never part of the journey, so sending you there is a
  // detour into work you did not ask for.
  it("goes back to the review when the journey started at a JD", async () => {
    useTailoringStore.setState({ jdId: "jd1" } as never);
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /back to review/i }));
    fireEvent.click(screen.getByRole("button", { name: /back to review/i }));
    expect(push).toHaveBeenCalledWith("/studio/r1/review");
  });

  // The six-section Builder belongs to résumés built there. Tailoring an
  // existing résumé against a JD is a different journey, and the Builder was
  // never part of it — offering it here invites a detour into work the user
  // deliberately skipped. Everything on the page is editable in place anyway,
  // contact details included, so nothing is out of reach without it.
  it("does not offer the Builder on the JD path", async () => {
    useTailoringStore.setState({ jdId: "jd1" } as never);
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /back to review/i }));
    expect(screen.queryByRole("button", { name: /edit full/i })).toBeNull();
  });

  it("does not duplicate it on the builder path either", async () => {
    // "Back to Builder" is already that control, to the same route.
    useTailoringStore.setState({ jdId: null, jdText: "" } as never);
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /back to builder/i }));
    expect(screen.queryByRole("button", { name: /edit full/i })).toBeNull();
  });

  it("goes back to the builder when there is no JD", async () => {
    useTailoringStore.setState({ jdId: null, jdText: "" } as never);
    await renderPage();
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /back to builder/i })));
    expect(push).toHaveBeenCalledWith("/studio/r1");
  });

  it("offers formatting in the space beside the document while editing", async () => {
    await renderPage();
    await waitFor(() => screen.getByRole("toolbar", { name: /formatting/i }));
    expect(screen.getByRole("button", { name: /bold/i })).toBeTruthy();
  });

  it("hides formatting in preview, where nothing is editable", async () => {
    await renderPage();
    await waitFor(() => screen.getByRole("tab", { name: /preview/i }));
    fireEvent.click(screen.getByRole("tab", { name: /preview/i }));
    await waitFor(() =>
      expect(screen.queryByRole("toolbar", { name: /formatting/i })).toBeNull(),
    );
  });

  it("offers the template picker on the JD path too", async () => {
    useTailoringStore.setState({ jdId: "jd1" } as never);
    await renderPage();
    await waitFor(() => screen.getByRole("button", { name: /template/i }));
    fireEvent.click(screen.getByRole("button", { name: /template/i }));
    expect(screen.getByRole("radio", { name: /minimal/i })).toBeTruthy();
  });

  it("keeps the template picker available in preview as well as edit", async () => {
    await renderPage();
    await waitFor(() => screen.getByRole("tab", { name: /preview/i }));
    fireEvent.click(screen.getByRole("tab", { name: /preview/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /template/i })).toBeTruthy());
  });

  // Picking a photo template without a photo is a 409 with a clear reason.
  // "We couldn't render your résumé" would send the user hunting for a fault
  // that is really a one-line fix they can make themselves.
  it("says why when the template needs a photo the résumé has not got", async () => {
    const { ApiError } = await import("../lib/api-client");
    vi.mocked(apiClient.renderResumeHtml).mockRejectedValueOnce(
      new ApiError(409, "Template 'ats_sidebar' requires a profile photo, but none was provided."),
    );
    await renderPage();
    await waitFor(() => screen.getByText(/requires a profile photo/i));
  });

  // Opening this link directly, or refreshing on it, left the store empty and
  // the page saying there was nothing to preview — the Builder was the only
  // route that fetched. Going back and forward again was the workaround.
  it("fetches the résumé when opened cold", async () => {
    useResumeStore.getState().resetStore();
    await renderPage();
    await waitFor(() => expect(apiClient.getResume).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(useResumeStore.getState().content?.summary).toBe("Fetched."));
  });

  it("renders the document it just fetched, rather than the empty notice", async () => {
    useResumeStore.getState().resetStore();
    await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalled());
    expect(screen.queryByText(/nothing to preview/i)).toBeNull();
  });

  // The notice gave a failure, a wait and an empty résumé the same flat
  // treatment: a dashed drop-zone frame, a 13px "title" barely larger than
  // its 11px detail, and no semantics at all.
  it("announces a failure as an alert, and names it as a heading", async () => {
    vi.mocked(apiClient.renderResumeHtml).mockRejectedValueOnce(new Error("boom"));
    await renderPage();
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(within(alert).getByRole("heading").textContent).toMatch(/couldn.t render/i);
  });

  it("announces a wait politely, not as an alert", async () => {
    vi.mocked(apiClient.renderResumeHtml).mockImplementationOnce(() => new Promise(() => {}));
    await renderPage();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives a failure its own tone rather than the neutral one", async () => {
    vi.mocked(apiClient.renderResumeHtml).mockRejectedValueOnce(new Error("boom"));
    await renderPage();
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.className).toMatch(/error/);
  });

  it("outranks the detail with the title", async () => {
    vi.mocked(apiClient.renderResumeHtml).mockImplementationOnce(() => new Promise(() => {}));
    await renderPage();
    const heading = screen.getByRole("heading", { name: /laying out/i });
    expect(heading.className).toContain("text-body-lg");
  });

  // The whole point of the preview is knowing what will export. A résumé
  // spilling onto a second page is the thing most worth knowing, and the
  // remedy — go back and turn points off — is on the previous screen.
  it("says how many pages the résumé takes", async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByTestId("page-count").textContent).toMatch(/1 page/i));
  });


  // The Type and Spacing panels write to resume-store. The render request
  // carried only the content, so the server fell back to the résumé row's
  // saved values: the user moved a slider and the document did not move.
  it("renders with the spacing, font and accent currently chosen", async () => {
    useResumeStore.setState({
      templateId: "ats_minimal", lineSpacing: 1.6, paragraphSpacing: 0,
      fontChoice: "serif", accentColor: "#112233",
    } as never);
    await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalled());
    expect(vi.mocked(apiClient.renderResumeHtml).mock.calls[0][1]).toMatchObject({
      template_id: "ats_minimal",
      line_spacing: 1.6,
      paragraph_spacing: 0,
      font_choice: "serif",
      accent_color: "#112233",
    });
  });

  it("re-renders when the spacing changes", async () => {
    await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalledTimes(1));
    await act(async () => {
      useResumeStore.getState().setSpacing(1.6, 20);
    });
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiClient.renderResumeHtml).mock.calls[1][1]).toMatchObject({
      line_spacing: 1.6, paragraph_spacing: 20,
    });
  });

  it("re-renders when the font changes", async () => {
    await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalledTimes(1));
    await act(async () => {
      useResumeStore.getState().setFontChoice("serif");
    });
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalledTimes(2));
  });

  it("renders at the chosen text sizes", async () => {
    useResumeStore.setState({ headingSizeDelta: 1, bodySizeDelta: -1 } as never);
    await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalled());
    expect(vi.mocked(apiClient.renderResumeHtml).mock.calls[0][1]).toMatchObject({
      heading_size_delta: 1,
      body_size_delta: -1,
    });
  });

  it("re-renders when a text size changes", async () => {
    await renderPage();
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalledTimes(1));
    await act(async () => {
      useResumeStore.getState().setTextSize("body", 1);
    });
    await waitFor(() => expect(apiClient.renderResumeHtml).toHaveBeenCalledTimes(2));
  });
});

describe("Export when the file cannot be fetched", () => {
  it("opens the PDF in a new tab instead of failing", async () => {
    const { downloadFile } = await import("../lib/download");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    try {
      await downloadFile("https://storage/x.pdf", "Resume.pdf");
      expect(open).toHaveBeenCalledWith("https://storage/x.pdf", "_blank", "noopener");
    } finally {
      open.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("says so when the browser blocks the new tab too", async () => {
    const { downloadFile } = await import("../lib/download");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      await expect(downloadFile("https://storage/x.pdf", "Resume.pdf")).rejects.toThrow(/allow pop-ups/);
    } finally {
      open.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("downloadFile with the PDF inline", () => {
  // POST /resumes/{id}/pdf returns the PDF itself as a data: URL. Browsers
  // refuse to open data: URLs in a new tab, so it must never rely on the
  // network path or its new-tab fallback — it is decoded in place.
  it("saves a data: URL without fetching it", async () => {
    const { downloadFile } = await import("../lib/download");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const blobs: Blob[] = [];
    const createUrl = vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    try {
      await downloadFile("data:application/pdf;base64,JVBERg==", "Jane Doe - Resume.pdf");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(names).toEqual(["Jane Doe - Resume.pdf"]);
      expect(blobs[0].type).toBe("application/pdf");
      expect(blobs[0].size).toBe(4); // "%PDF"
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("resumeFileName", () => {
  it("drops characters a file system rejects", async () => {
    const { resumeFileName } = await import("../lib/download");
    expect(resumeFileName('Jane\\Doe/: "QA"')).toBe("JaneDoe QA - Resume.pdf");
    expect(resumeFileName("  ")).toBe("Resume.pdf");
    expect(resumeFileName(undefined)).toBe("Resume.pdf");
  });
});
