// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getQuestions: vi.fn(),
    getResumes: vi.fn().mockResolvedValue([]),
    getJds: vi.fn().mockResolvedValue([]),
    getQuestionBank: vi.fn(),
    markQuestionPracticed: vi.fn(),
    getLatestSession: vi.fn().mockResolvedValue({ session_id: null }),
  },
}));

import InterviewIndexPage from "../app/(app)/interview/page";
import { useTailoringStore } from "../stores/tailoring-store";
import { apiClient } from "../lib/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("InterviewIndexPage — no active session", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
  });

  it("shows real bank questions for the active topic instead of fake local progress cards", async () => {
    vi.mocked(apiClient.getQuestionBank).mockResolvedValue([
      {
        id: "q-1",
        skill: "kubernetes",
        topic: "Technical",
        question: "Describe how you've used Kubernetes in production.",
        answer_framework: "STAR: ...",
      },
    ]);

    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/Describe how you've used Kubernetes/)).toBeInTheDocument();
    expect(apiClient.getQuestionBank).toHaveBeenCalledWith("Technical");
  });

  it("re-fetches the bank when switching tabs", async () => {
    vi.mocked(apiClient.getQuestionBank).mockResolvedValue([]);
    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Behavioral");
    await userEvent.click(screen.getByText("Behavioral"));

    await waitFor(() =>
      expect(apiClient.getQuestionBank).toHaveBeenCalledWith("Behavioral")
    );
  });
});

describe("InterviewIndexPage — no in-memory session but a real one exists server-side", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
  });

  it("resolves the latest real session instead of falling back to the shared bank", async () => {
    // Simulates a page reload: the in-memory tailoring store's sessionId is
    // gone, but the user does have a real completed tailoring session.
    vi.mocked(apiClient.getLatestSession).mockResolvedValue({
      session_id: "session-latest",
      matched_skills: ["Python"],
      missing_skills: ["Kubernetes"],
    });
    vi.mocked(apiClient.getQuestions).mockResolvedValue([
      {
        id: "q-real",
        session_id: "session-latest",
        topic: "Technical",
        question: "Tell me about a time you used Python in production.",
        answer_framework: "STAR: ...",
        is_gap_based: false,
        order_index: 0,
        practiced_at: null,
      },
    ]);
    vi.mocked(apiClient.getQuestionBank).mockResolvedValue([]);

    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/Tell me about a time you used Python/)).toBeInTheDocument();
    expect(apiClient.getQuestions).toHaveBeenCalledWith("session-latest");
  });
});

describe("InterviewIndexPage — session active but zero prep questions", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
  });

  it("falls back to the shared bank instead of showing the empty state forever", async () => {
    useTailoringStore.setState({ sessionId: "session-1" });
    vi.mocked(apiClient.getQuestions).mockResolvedValue([]);
    vi.mocked(apiClient.getQuestionBank).mockResolvedValue([
      {
        id: "q-1",
        skill: "kubernetes",
        topic: "Technical",
        question: "Describe how you've used Kubernetes in production.",
        answer_framework: "STAR: ...",
      },
    ]);

    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/Describe how you've used Kubernetes/)).toBeInTheDocument();
    expect(screen.queryByText(/No Technical questions yet/)).not.toBeInTheDocument();
  });
});
