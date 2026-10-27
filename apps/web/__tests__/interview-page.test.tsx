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
    getJdDetails: vi.fn().mockResolvedValue({
      session_id: "run-1", questions_total: 0, questions_practiced: 0, questions_session_id: null,
      questions_match_resume: null, resume_saved: true,
    }),
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
      screen.getByText(/made for a job on request/i)
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

  it("shows why a first set of questions failed, which has no card to show it on", async () => {
    vi.mocked(apiClient.getJds).mockResolvedValue([{ id: "jd-1", title: "Backend Engineer" }] as never);
    usePrepQuestionsStore.setState({ pending: {}, errors: { "jd-1": "Not enough credits." } });
    try {
      renderWithQueryClient(<InterviewIndexPage />);
      // The title arrives with the JD list.
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          /Couldn't make interview questions for Backend Engineer: Not enough credits\./,
        ),
      );
      expect(screen.getByRole("link", { name: /Open the JD/ })).toHaveAttribute("href", "/jd/jd-1");
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

  it("asks before regenerating — the cost, and that practice progress is lost", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      question("acme", { practiced_at: "2026-10-01T00:00:00Z" }),
      question("acme", { id: "q-acme-2", question: "Second Acme question" }),
    ]);
    renderWithQueryClient(<InterviewIndexPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    expect(screen.getByText(/Replace these 2 questions with a new set\?/)).toBeInTheDocument();
    expect(screen.getByText(/Costs 2 credits\. This JD's practice progress \(1 done\) will be lost\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Replace these 2 questions/)).not.toBeInTheDocument();
    expect(apiClient.generateJdPrepQuestions).not.toHaveBeenCalled();
  });

  it("says written follow-up answers are lost too, since they were paid for", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      question("acme", {
        followups: [
          { id: "f1", position: 1, question: "Why?", answer: "Direct answer: because." },
          { id: "f2", position: 2, question: "And then?", answer: null },
        ],
      }),
    ]);
    renderWithQueryClient(<InterviewIndexPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    expect(screen.getByText(/This JD's 1 written follow-up answer will be lost\./)).toBeInTheDocument();
  });

  it("files HR & Culture questions under their own tab, not Behavioral", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([
      question("acme", { id: "q-hr", topic: "HR & Culture", question: "Why this team?" }),
      question("acme", { id: "q-beh", topic: "Behavioral", question: "A time you disagreed." }),
    ]);
    renderWithQueryClient(<InterviewIndexPage />);

    await userEvent.click(await screen.findByRole("button", { name: /HR & Culture \(1\)/ }));
    expect(screen.getByText("Why this team?")).toBeInTheDocument();
    expect(screen.queryByText("A time you disagreed.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Behavioral \(1\)/ }));
    expect(screen.getByText("A time you disagreed.")).toBeInTheDocument();
    expect(screen.queryByText("Why this team?")).not.toBeInTheDocument();
  });

  it("says when the job's résumé was edited after its questions were made", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([question("acme", { resume_changed: true })]);
    renderWithQueryClient(<InterviewIndexPage />);

    expect(
      await screen.findByText(/résumé for this job was edited after these questions were made/),
    ).toBeInTheDocument();
  });

  it("says nothing about edits when the résumé is unchanged", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([question("acme", { resume_changed: false })]);
    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Acme technical question");
    expect(screen.queryByText(/was edited after these questions were made/)).not.toBeInTheDocument();
  });

  it("names the steps the readiness score counts", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([question("acme")]);
    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Acme technical question");
    for (const step of ["JD analyzed", "Résumé tailored", "Questions ready", "Questions practiced"]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.queryByText("Session started")).not.toBeInTheDocument();
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

describe("InterviewIndexPage — making questions from here", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
    usePrepQuestionsStore.setState({ pending: {}, errors: {}, offer: null });
    vi.mocked(apiClient.getLatestSession).mockResolvedValue({ session_id: null });
    vi.mocked(apiClient.getSubscription).mockResolvedValue(
      { credits_remaining: 40, costs: { prep_questions: 5 } } as never,
    );
  });

  const has = {
    id: "q-1", session_id: "run-0", jd_id: "jd-has", jd_title: "Has a set", topic: "Technical",
    question: "A question", answer_framework: "", is_gap_based: false, source: "requirement",
    basis: "", order_index: 1, practiced_at: null,
  };

  it("lists only saved jobs with no set, and makes one only through the question", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([has]);
    vi.mocked(apiClient.getJds).mockResolvedValue([
      { id: "jd-has", title: "Has a set", tailored_resume_id: "r0", created_at: "2026-10-01" },
      { id: "jd-ready", title: "Saved, no set", tailored_resume_id: "r1", created_at: "2026-10-02" },
      { id: "jd-analyzed", title: "Only analyzed", tailored_resume_id: null, created_at: "2026-10-03" },
    ] as never);
    renderWithQueryClient(<InterviewIndexPage />);

    const ready = await screen.findByRole("region", { name: "Ready for interview questions" });
    expect(ready).toHaveTextContent("Saved, no set");
    expect(ready).not.toHaveTextContent("Has a set");
    expect(ready).not.toHaveTextContent("Only analyzed");

    await userEvent.click(screen.getByRole("button", { name: "Generate interview questions for Saved, no set" }));
    expect(apiClient.generateJdPrepQuestions).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Make questions · 5 credits" }));
    await waitFor(() => expect(apiClient.generateJdPrepQuestions).toHaveBeenCalledWith("jd-ready", undefined));
  });

  it("drops a job from the list while its set is being made", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([]);
    vi.mocked(apiClient.getJds).mockResolvedValue([
      { id: "jd-ready", title: "Saved, no set", tailored_resume_id: "r1", created_at: "2026-10-02" },
    ] as never);
    usePrepQuestionsStore.setState({ pending: { "jd-ready": "Saved, no set" }, errors: {}, offer: null });
    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/Preparing interview questions for Saved, no set/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ready for interview questions" })).toBeNull();
    usePrepQuestionsStore.setState({ pending: {}, errors: {}, offer: null });
  });

  it("shows the list instead of the empty page when no job has a set yet", async () => {
    vi.mocked(apiClient.getMyQuestions).mockResolvedValue([]);
    vi.mocked(apiClient.getJds).mockResolvedValue([
      { id: "jd-ready", title: "Saved, no set", tailored_resume_id: "r1", created_at: "2026-10-02" },
    ] as never);
    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByRole("region", { name: "Ready for interview questions" })).toBeInTheDocument();
    expect(screen.queryByText(/No interview questions yet/)).toBeNull();
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
