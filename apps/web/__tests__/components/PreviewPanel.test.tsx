// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
    expect(apiClient.generatePdf).toHaveBeenCalledWith("resume-1", "ats_clean");
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
});
