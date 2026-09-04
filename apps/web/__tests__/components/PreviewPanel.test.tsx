// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    generatePdf: vi.fn(),
    updateResume: vi.fn().mockResolvedValue({}),
  },
}));

import { PreviewPanel } from "../../components/resume/PreviewPanel";
import { useResumeStore } from "../../stores/resume-store";
import { useTailoringStore } from "../../stores/tailoring-store";
import { apiClient } from "../../lib/api-client";

const SAMPLE_CONTENT = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [],
  education: [],
  skills: [],
};

describe("PreviewPanel", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
    pushMock.mockClear();
    vi.mocked(apiClient.generatePdf).mockReset();
    // Default so mounting with a resume (which now auto-renders a preview —
    // see next test) always has something to resolve to; individual tests
    // override this when the returned URL matters.
    vi.mocked(apiClient.generatePdf).mockResolvedValue({
      signed_url: "https://example.com/resume.pdf",
    });
  });

  it("shows the empty state when no PDF has been generated", () => {
    render(<PreviewPanel />);
    expect(screen.getByText("No preview yet")).toBeInTheDocument();
    expect(screen.queryByTitle("Resume Preview")).not.toBeInTheDocument();
  });

  it("Refresh preview is disabled until a resume is loaded", () => {
    render(<PreviewPanel />);
    expect(screen.getByText("Refresh preview").closest("button")).toBeDisabled();
  });

  it("auto-renders a preview once a resume is loaded — this panel only mounts when Preview is opened, so opening it should show something immediately", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");

    render(<PreviewPanel />);

    await waitFor(() => {
      expect(screen.getByTitle("Resume Preview")).toHaveAttribute(
        "src",
        "https://example.com/resume.pdf#toolbar=0"
      );
    });
    expect(apiClient.generatePdf).toHaveBeenCalledWith("resume-1", "ats_clean", undefined, 1.25, 12);
  });

  it("does not auto-render in tailoring mode — BulletReviewPanel owns that first render", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    act(() => {
      useTailoringStore.setState({ pendingContent: SAMPLE_CONTENT, bulletDecisions: {}, suggestedSkills: [] });
    });
    render(<PreviewPanel />);
    expect(apiClient.generatePdf).not.toHaveBeenCalled();
  });

  it("does not re-fetch when a preview already exists on mount (e.g. opened with one already loaded)", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    act(() => {
      useResumeStore.getState().setPdfSignedUrl("https://example.com/already-loaded.pdf");
    });
    render(<PreviewPanel />);
    expect(apiClient.generatePdf).not.toHaveBeenCalled();
    expect(screen.getByTitle("Resume Preview")).toHaveAttribute(
      "src",
      "https://example.com/already-loaded.pdf#toolbar=0"
    );
  });

  it("shows the Interview Prep button only when a tailoring session exists", () => {
    const { rerender } = render(<PreviewPanel />);
    expect(screen.queryByText("Interview Prep")).not.toBeInTheDocument();

    act(() => {
      useTailoringStore.setState({ sessionId: "session-1" });
    });
    rerender(<PreviewPanel />);
    expect(screen.getByText("Interview Prep")).toBeInTheDocument();
  });

  it("navigates to the interview session when Interview Prep is clicked", async () => {
    useTailoringStore.setState({ sessionId: "session-42" });
    render(<PreviewPanel />);
    await userEvent.click(screen.getByText("Interview Prep"));
    expect(pushMock).toHaveBeenCalledWith("/interview/session-42");
  });

  it("adjusting spacing after a PDF exists marks it stale and relabels the button Update preview", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");

    render(<PreviewPanel />);
    await waitFor(() => expect(screen.getByTitle("Resume Preview")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "1.5" } });

    expect(useResumeStore.getState().lineSpacing).toBe(1.5);
    expect(screen.getByText("Update preview")).toBeInTheDocument();
  });

  it("Update preview sends the updated spacing values and clears the stale state", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");

    render(<PreviewPanel />);
    await waitFor(() => expect(screen.getByTitle("Resume Preview")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Paragraph spacing"), { target: { value: "20" } });
    await userEvent.click(screen.getByText("Update preview"));

    await waitFor(() =>
      expect(apiClient.generatePdf).toHaveBeenLastCalledWith("resume-1", "ats_clean", undefined, 1.25, 20)
    );
    expect(screen.getByText("Refresh preview")).toBeInTheDocument();
    expect(screen.queryByText("Update preview")).not.toBeInTheDocument();
  });

  it("hides spacing controls until a preview actually exists, in normal mode", () => {
    render(<PreviewPanel />);
    expect(screen.queryByLabelText("Line spacing")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Paragraph spacing")).not.toBeInTheDocument();
  });

  it("hides spacing controls in tailoring mode until a tailored preview exists", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    act(() => {
      useTailoringStore.setState({ pendingContent: SAMPLE_CONTENT, bulletDecisions: {}, suggestedSkills: [] });
    });
    render(<PreviewPanel />);
    expect(screen.queryByLabelText("Line spacing")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Paragraph spacing")).not.toBeInTheDocument();
  });

  it("shows spacing controls in tailoring mode once a tailored preview exists — previously always hidden in this mode", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    act(() => {
      useTailoringStore.setState({ pendingContent: SAMPLE_CONTENT, bulletDecisions: {}, suggestedSkills: [] });
      useResumeStore.getState().setPdfSignedUrl("https://example.com/tailored.pdf");
    });
    render(<PreviewPanel />);
    expect(screen.getByLabelText("Line spacing")).toBeInTheDocument();
    expect(screen.getByLabelText("Paragraph spacing")).toBeInTheDocument();
  });

  it("regenerating a tailored preview after a spacing change reuses generatePreview with the new spacing", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    act(() => {
      useTailoringStore.setState({ pendingContent: SAMPLE_CONTENT, bulletDecisions: {}, suggestedSkills: [] });
      useResumeStore.getState().setPdfSignedUrl("https://example.com/tailored.pdf");
    });
    vi.mocked(apiClient.generatePdf).mockResolvedValue({
      signed_url: "https://example.com/tailored-v2.pdf",
    });

    render(<PreviewPanel />);
    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "1.4" } });
    expect(screen.getByText("Update preview")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Update preview"));

    await waitFor(() =>
      expect(apiClient.generatePdf).toHaveBeenLastCalledWith(
        "resume-1", "ats_clean", expect.any(Object), 1.4, 12
      )
    );
  });

  it("shows the matching preset label when spacing matches one, and Custom otherwise", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<PreviewPanel />);
    await waitFor(() => expect(screen.getByTitle("Resume Preview")).toBeInTheDocument());

    // Default (1.25, 12) matches none of the three presets exactly.
    expect(screen.getByLabelText("Spacing")).toHaveValue("Custom");

    fireEvent.change(screen.getByLabelText("Spacing"), { target: { value: "Compact" } });
    expect(useResumeStore.getState().lineSpacing).toBe(1.0);
    expect(useResumeStore.getState().paragraphSpacing).toBe(8);
    expect(screen.getByLabelText("Spacing")).toHaveValue("Compact");
  });

  it("picking a spacing preset marks the preview stale, same as a manual slider change", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    render(<PreviewPanel />);
    await waitFor(() => expect(screen.getByTitle("Resume Preview")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Spacing"), { target: { value: "Spacious" } });

    expect(useResumeStore.getState().lineSpacing).toBe(1.4);
    expect(useResumeStore.getState().paragraphSpacing).toBe(18);
    expect(screen.getByText("Update preview")).toBeInTheDocument();
  });
});
