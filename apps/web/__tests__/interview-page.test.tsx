// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getMyQuestions: vi.fn().mockResolvedValue([]),
    getResumes: vi.fn().mockResolvedValue([]),
    getJds: vi.fn().mockResolvedValue([]),
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
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([]);
  });

  it("shows only the 'tailor a resume to a JD' CTA when the user has no generated questions", async () => {
    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/No interview questions yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/generated when you tailor a resume to a specific job description/i)
    ).toBeInTheDocument();
  });

  it("still shows only the CTA after switching tabs", async () => {
    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Behavioral");
    await userEvent.click(screen.getByText("Behavioral"));

    expect(await screen.findByText(/No interview questions yet/)).toBeInTheDocument();
  });
});

describe("InterviewIndexPage — real questions exist across JDs", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.getLatestSession).mockResolvedValue({ session_id: null });
  });

  it("shows the user's real generated questions", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      {
        id: "q-real",
        session_id: "session-latest",
        jd_id: "jd-1",
        jd_title: "Senior Backend Engineer — Acme",
        topic: "Technical",
        question: "Tell me about a time you used Python in production.",
        answer_framework: "STAR: ...",
        is_gap_based: false,
        source: "requirement",
        basis: "",
        order_index: 0,
        practiced_at: null,
      },
    ]);

    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/Tell me about a time you used Python/)).toBeInTheDocument();
  });

  it("groups questions under their JD's name when multiple JDs have questions", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      {
        id: "q-acme",
        session_id: "session-acme",
        jd_id: "jd-acme",
        jd_title: "Senior Backend Engineer — Acme",
        topic: "Technical",
        question: "Acme technical question",
        answer_framework: "STAR: ...",
        is_gap_based: false,
        source: "requirement",
        basis: "",
        order_index: 0,
        practiced_at: null,
      },
      {
        id: "q-globex",
        session_id: "session-globex",
        jd_id: "jd-globex",
        jd_title: "Staff Engineer — Globex",
        topic: "Technical",
        question: "Globex technical question",
        answer_framework: "STAR: ...",
        is_gap_based: false,
        source: "requirement",
        basis: "",
        order_index: 0,
        practiced_at: null,
      },
    ]);

    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText("Acme technical question")).toBeInTheDocument();
    expect(screen.getByText("Globex technical question")).toBeInTheDocument();
    // Group headers specifically (as opposed to the JD filter's <option>s,
    // which also carry this text).
    expect(screen.getByText("Senior Backend Engineer — Acme", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Staff Engineer — Globex", { selector: "p" })).toBeInTheDocument();
  });

  it("filters down to one JD's questions via the JD filter, hiding its group header", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      {
        id: "q-acme",
        session_id: "session-acme",
        jd_id: "jd-acme",
        jd_title: "Senior Backend Engineer — Acme",
        topic: "Technical",
        question: "Acme technical question",
        answer_framework: "STAR: ...",
        is_gap_based: false,
        source: "requirement",
        basis: "",
        order_index: 0,
        practiced_at: null,
      },
      {
        id: "q-globex",
        session_id: "session-globex",
        jd_id: "jd-globex",
        jd_title: "Staff Engineer — Globex",
        topic: "Technical",
        question: "Globex technical question",
        answer_framework: "STAR: ...",
        is_gap_based: false,
        source: "requirement",
        basis: "",
        order_index: 0,
        practiced_at: null,
      },
    ]);

    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Acme technical question");
    const filter = screen.getByRole("combobox");
    await userEvent.selectOptions(filter, "jd-acme");

    expect(screen.getByText("Acme technical question")).toBeInTheDocument();
    expect(screen.queryByText("Globex technical question")).not.toBeInTheDocument();
    // Only one JD in scope now — no redundant group header (the JD's name
    // still legitimately appears once, as the filter's selected <option>).
    expect(screen.queryByText("Senior Backend Engineer — Acme", { selector: "p" })).not.toBeInTheDocument();
  });
});

describe("InterviewIndexPage — no real questions for any JD", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([]);
  });

  it("shows the empty-state CTA even with an active session but no generated questions", async () => {
    useTailoringStore.setState({ sessionId: "session-1" });

    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/No interview questions yet/)).toBeInTheDocument();
  });
});
