// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    renderResumeHtml: vi.fn(async () => ({
      html: '<p data-field="summary">Old summary.</p>',
    })),
    generatePdf: vi.fn(async () => ({ signed_url: "u", underfilled: false })),
  },
}));

import StudioPreviewPage from "../app/(builder)/studio/[resumeId]/preview/page";
import { useResumeStore } from "../stores/resume-store";
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

  it("says so when there is no résumé to preview", async () => {
    useResumeStore.setState({ content: null } as never);
    await renderPage();
    expect(screen.getByText(/nothing to preview/i)).toBeTruthy();
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
});
