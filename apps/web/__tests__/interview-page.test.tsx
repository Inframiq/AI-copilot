// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getMyQuestions: vi.fn().mockResolvedValue([]),
    getResumes: vi.fn().mockResolvedValue([]),
    getJds: vi.fn().mockResolvedValue([]),
    markQuestionPracticed: vi.fn(),
    getLatestSession: vi.fn().mockResolvedValue({ session_id: null }),
    getSubscription: vi.fn().mockResolvedValue({ costs: { prep_questions: 2 } }),
    generateJdPrepQuestions: vi.fn().mockResolvedValue({ session_id: "s", questions_total: 10 }),
  },
}));

import InterviewIndexPage from "../app/(app)/interview/page";
import { useTailoringStore } from "../stores/tailoring-store";
import { usePrepQuestionsStore } from "../stores/prep-questions-store";
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

  it("shows only the 'save a tailored résumé to a JD' CTA when the user has no generated questions", async () => {
    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/No interview questions yet/)).toBeInTheDocument();
    expect(
      screen.getByText(/made when you save a tailored résumé to\s+a job/i)
    ).toBeInTheDocument();
  });

  it("says questions are being prepared while a Save to JD is making them", async () => {
    usePrepQuestionsStore.setState({ pending: { "jd-1": "Backend Engineer" }, errors: {} });
    try {
      renderWithQueryClient(<InterviewIndexPage />);
      expect(await screen.findByRole("status")).toHaveTextContent(
        /Preparing interview questions for Backend Engineer/,
      );
    } finally {
      usePrepQuestionsStore.setState({ pending: {}, errors: {} });
    }
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

  function question(jd: "acme" | "globex", overrides: Record<string, unknown> = {}) {
    return {
      id: `q-${jd}`,
      session_id: `session-${jd}`,
      jd_id: `jd-${jd}`,
      jd_title: jd === "acme" ? "Senior Backend Engineer — Acme" : "Staff Engineer — Globex",
      topic: "Technical",
      question: `${jd === "acme" ? "Acme" : "Globex"} technical question`,
      answer_framework: "STAR: ...",
      is_gap_based: false,
      source: "requirement",
      basis: "",
      order_index: 0,
      practiced_at: null,
      ...overrides,
    };
  }

  function twoJds() {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([question("acme"), question("globex")]);
    // Globex was analyzed more recently, so it opens first.
    vi.mocked(apiClient.getJds).mockResolvedValue([
      { id: "jd-acme", created_at: "2026-09-01T00:00:00Z" },
      { id: "jd-globex", created_at: "2026-10-01T00:00:00Z" },
    ] as never);
  }

  beforeEach(() => {
    nav.params = new URLSearchParams();
  });

  it("shows one JD's questions at a time — the newest JD by default", async () => {
    twoJds();
    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText("Globex technical question")).toBeInTheDocument();
    expect(screen.queryByText("Acme technical question")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Questions for")).toHaveValue("jd-globex"),
    );
    expect(screen.getByText("JD 1 of 2")).toBeInTheDocument();
  });

  it("switches to another JD's questions from the dropdown and puts it in the URL", async () => {
    twoJds();
    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Globex technical question");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    await userEvent.selectOptions(screen.getByLabelText("Questions for"), "jd-acme");

    expect(screen.getByText("Acme technical question")).toBeInTheDocument();
    expect(screen.queryByText("Globex technical question")).not.toBeInTheDocument();
    expect(nav.replace).toHaveBeenCalledWith("/interview?jd=jd-acme", { scroll: false });
  });

  it("steps between JDs with the next/previous arrows", async () => {
    twoJds();
    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Globex technical question");
    await waitFor(() => expect(screen.getByText("JD 1 of 2")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Previous job description" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next job description" }));
    expect(screen.getByText("Acme technical question")).toBeInTheDocument();
    expect(screen.getByText("JD 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next job description" })).toBeDisabled();
  });

  it("opens the JD named in ?jd=", async () => {
    twoJds();
    nav.params = new URLSearchParams("jd=jd-acme");
    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText("Acme technical question")).toBeInTheDocument();
    expect(screen.queryByText("Globex technical question")).not.toBeInTheDocument();
  });

  it("counts practice per JD in the switcher", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      question("acme", { practiced_at: "2026-10-01T00:00:00Z" }),
      question("acme", { id: "q-acme-2", question: "Second Acme question" }),
    ]);
    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText("1 of 2 practiced")).toBeInTheDocument();
    // One JD — nothing to step between.
    expect(screen.queryByRole("button", { name: "Next job description" })).not.toBeInTheDocument();
  });

  it("says so when Mark as Practiced doesn't save, and undoes the tick", async () => {
    vi.mocked(apiClient.markQuestionPracticed).mockRejectedValueOnce(new Error("500"));
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([question("acme")]);
    renderWithQueryClient(<InterviewIndexPage />);

    await userEvent.click(await screen.findByRole("button", { name: /Mark as Practiced/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't mark this as practiced — it wasn't saved/);
    expect(screen.getByRole("button", { name: /Mark as Practiced/ })).toBeInTheDocument();
    expect(screen.getByText("0 of 1 practiced")).toBeInTheDocument();
  });

  it("asks before regenerating — the cost, and that practice progress starts over", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      question("acme", { practiced_at: "2026-10-01T00:00:00Z" }),
      question("acme", { id: "q-acme-2", question: "Second Acme question" }),
    ]);
    renderWithQueryClient(<InterviewIndexPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    expect(screen.getByText(/Replace these 2 questions with a new set\?/)).toBeInTheDocument();
    expect(screen.getByText(/Costs 2 credits; your practice progress on this JD \(1 done\) starts over/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Replace these 2 questions/)).not.toBeInTheDocument();
    expect(apiClient.generateJdPrepQuestions).not.toHaveBeenCalled();
  });

  it("regenerates the selected JD's set once confirmed", async () => {
    let finish!: () => void;
    vi.mocked(apiClient.generateJdPrepQuestions).mockImplementation(
      () => new Promise((resolve) => { finish = () => resolve({ session_id: "s", questions_total: 1 }); }),
    );
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([question("acme")]);
    renderWithQueryClient(<InterviewIndexPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    const confirm = screen.getAllByRole("button", { name: "Regenerate" }).at(-1)!;
    await userEvent.click(confirm);

    expect(apiClient.generateJdPrepQuestions).toHaveBeenCalledWith("jd-acme", undefined, { regenerate: true });
    // The old set stays on screen while the new one is written.
    expect(await screen.findByText(/these questions stay until it's ready/)).toBeInTheDocument();
    expect(screen.getByText("Acme technical question")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerating/ })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled());
    expect(apiClient.getMyQuestions).toHaveBeenCalledTimes(2); // refetched the new set
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
