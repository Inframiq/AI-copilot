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
  });

  it("shows the empty state when no PDF has been generated", () => {
    render(<PreviewPanel />);
    expect(screen.getByText("No PDF generated yet")).toBeInTheDocument();
    expect(screen.queryByTitle("Resume Preview")).not.toBeInTheDocument();
  });

  it("Generate PDF is disabled until a resume is loaded", () => {
    render(<PreviewPanel />);
    expect(screen.getByText("Generate PDF").closest("button")).toBeDisabled();
  });

  it("clicking Generate PDF calls the API and renders the iframe on success", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    vi.mocked(apiClient.generatePdf).mockResolvedValue({
      signed_url: "https://example.com/resume.pdf",
    });

    render(<PreviewPanel />);
    await userEvent.click(screen.getByText("Generate PDF"));

    await waitFor(() => {
      expect(screen.getByTitle("Resume Preview")).toHaveAttribute(
        "src",
        "https://example.com/resume.pdf"
      );
    });
    expect(apiClient.generatePdf).toHaveBeenCalledWith("resume-1", "ats_clean", undefined, 1.25, 12);
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

  it("switches templates on click", async () => {
    render(<PreviewPanel />);
    await userEvent.click(screen.getByText("ATS Modern"));
    expect(useResumeStore.getState().templateId).toBe("ats_modern");
  });

  it("adjusting spacing after a PDF exists marks it stale and relabels the button Regenerate PDF", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    vi.mocked(apiClient.generatePdf).mockResolvedValue({
      signed_url: "https://example.com/resume.pdf",
    });

    render(<PreviewPanel />);
    await userEvent.click(screen.getByText("Generate PDF"));
    await waitFor(() => expect(screen.getByTitle("Resume Preview")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Line spacing"), { target: { value: "1.5" } });

    expect(useResumeStore.getState().lineSpacing).toBe(1.5);
    expect(screen.getByText("Regenerate PDF")).toBeInTheDocument();
  });

  it("Regenerate PDF sends the updated spacing values and clears the stale state", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    vi.mocked(apiClient.generatePdf).mockResolvedValue({
      signed_url: "https://example.com/resume.pdf",
    });

    render(<PreviewPanel />);
    await userEvent.click(screen.getByText("Generate PDF"));
    await waitFor(() => expect(screen.getByTitle("Resume Preview")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Paragraph spacing"), { target: { value: "20" } });
    await userEvent.click(screen.getByText("Regenerate PDF"));

    await waitFor(() =>
      expect(apiClient.generatePdf).toHaveBeenLastCalledWith("resume-1", "ats_clean", undefined, 1.25, 20)
    );
    expect(screen.getByText("Generate PDF")).toBeInTheDocument();
    expect(screen.queryByText("Regenerate PDF")).not.toBeInTheDocument();
  });

  it("hides spacing controls until a preview actually exists, in normal mode", () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
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
    expect(screen.getByText("Regenerate Preview")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Regenerate Preview"));

    await waitFor(() =>
      expect(apiClient.generatePdf).toHaveBeenLastCalledWith(
        "resume-1", "ats_clean", expect.any(Object), 1.4, 12
      )
    );
  });

  it("shows the matching preset label when spacing matches one, and Custom otherwise", async () => {
    useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "https://example.com/resume.pdf" });
    render(<PreviewPanel />);
    await userEvent.click(screen.getByText("Generate PDF"));
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
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "https://example.com/resume.pdf" });
    render(<PreviewPanel />);
    await userEvent.click(screen.getByText("Generate PDF"));
    await waitFor(() => expect(screen.getByTitle("Resume Preview")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Spacing"), { target: { value: "Spacious" } });

    expect(useResumeStore.getState().lineSpacing).toBe(1.4);
    expect(useResumeStore.getState().paragraphSpacing).toBe(18);
    expect(screen.getByText("Regenerate PDF")).toBeInTheDocument();
  });
});
