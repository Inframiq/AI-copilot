// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { PrepQuestionOut } from "@career-copilot/types";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getSubscription: vi.fn().mockResolvedValue({ costs: { followup_answer: 3 } }),
    answerFollowup: vi.fn(),
  },
}));

import { QuestionCard } from "../../components/interview/QuestionCard";
import { apiClient } from "../../lib/api-client";

function question(overrides: Partial<PrepQuestionOut> = {}): PrepQuestionOut {
  return {
    id: "q1",
    session_id: "s1",
    topic: "Behavioral",
    question: "Tell me about the pipeline you owned.",
    answer_framework: "",
    likely_answer: "Situation: The billing pipeline at Acme.\nResult: name the metric you tracked.",
    followups: [{ id: "f1", position: 1, question: "How did you catch mismatches?", answer: null }],
    is_gap_based: false,
    source: "requirement",
    basis: "Own the pipeline",
    order_index: 1,
    practiced_at: null,
    ...overrides,
  };
}

/** Renders the card the way the session page does: from the query cache, so
 * a new chain written there shows up. */
function FromCache({ q }: { q: PrepQuestionOut }) {
  const { data = [] } = useQuery<PrepQuestionOut[]>({
    queryKey: ["questions", q.session_id],
    queryFn: () => [q],
    initialData: [q],
    staleTime: Infinity,
  });
  return <QuestionCard question={data[0]} practiced={false} />;
}

function renderCard(q: PrepQuestionOut) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FromCache q={q} />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  localStorage.clear();
});

describe("QuestionCard", () => {
  it("shows the likely answer as labelled lines, then the first follow-up", async () => {
    renderCard(question());
    await userEvent.click(screen.getByRole("button", { name: "Show a likely answer" }));

    expect(screen.getByText("Situation:")).toBeTruthy();
    expect(screen.getByText("The billing pipeline at Acme.", { exact: false })).toBeTruthy();
    const chain = screen.getByRole("list", { name: "Follow-up questions" });
    expect(within(chain).getByText("How did you catch mismatches?")).toBeTruthy();
    expect(within(chain).getByRole("button", { name: /Write a likely answer · 3 credits/ })).toBeTruthy();
  });

  it("shows what the question tests before any answer is opened", () => {
    renderCard(question({ interviewer_intent: "Mid level: owning a pipeline end to end." }));

    expect(screen.getByText("What they're testing:")).toBeTruthy();
    expect(screen.getByText("Mid level: owning a pipeline end to end.")).toBeTruthy();
  });

  it("older sets with nothing on what is tested show no empty label", () => {
    renderCard(question({ interviewer_intent: null }));

    expect(screen.queryByText("What they're testing:")).toBeNull();
  });

  it("asks before the first paid answer, then writes it and shows the next follow-up", async () => {
    vi.mocked(apiClient.answerFollowup).mockResolvedValue([
      { id: "f1", position: 1, question: "How did you catch mismatches?", answer: "Direct answer: nightly diffs." },
      { id: "f2", position: 2, question: "What broke first?", answer: null },
    ]);
    renderCard(question());
    await userEvent.click(screen.getByRole("button", { name: "Show a likely answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Write a likely answer/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/costs 3 credits/)).toBeTruthy();
    expect(apiClient.answerFollowup).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Write answer · 3 credits" }));

    expect(apiClient.answerFollowup).toHaveBeenCalledWith("f1");
    expect(await screen.findByText("What broke first?")).toBeTruthy();
    expect(screen.getByText("nightly diffs.", { exact: false })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("doesn't ask again once the cost was accepted", async () => {
    localStorage.setItem("kripax-followup-cost-seen", "1");
    vi.mocked(apiClient.answerFollowup).mockResolvedValue([
      { id: "f1", position: 1, question: "How did you catch mismatches?", answer: "Direct answer: diffs." },
    ]);
    renderCard(question());
    await userEvent.click(screen.getByRole("button", { name: "Show a likely answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Write a likely answer/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiClient.answerFollowup).toHaveBeenCalledWith("f1");
  });

  it("cancelling the notice charges nothing", async () => {
    renderCard(question());
    await userEvent.click(screen.getByRole("button", { name: "Show a likely answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Write a likely answer/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiClient.answerFollowup).not.toHaveBeenCalled();
    expect(localStorage.getItem("kripax-followup-cost-seen")).toBeNull();
  });

  it("shows the server's reason when an answer can't be written", async () => {
    localStorage.setItem("kripax-followup-cost-seen", "1");
    vi.mocked(apiClient.answerFollowup).mockRejectedValue(
      new Error("Out of credits: A follow-up answer costs 3 credits and you have 1."),
    );
    renderCard(question());
    await userEvent.click(screen.getByRole("button", { name: "Show a likely answer" }));
    await userEvent.click(screen.getByRole("button", { name: /Write a likely answer/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("Out of credits");
    expect(screen.getByRole("button", { name: /Write a likely answer/ })).toBeTruthy();
  });

  it("older sets keep their answer guide, with the follow-up from the chain", async () => {
    renderCard(question({
      likely_answer: null,
      answer_framework: "Name the trade-off. Likely follow-up: Why not batch?",
      followups: [{ id: "f1", position: 1, question: "Why not batch?", answer: null }],
    }));
    await userEvent.click(screen.getByRole("button", { name: "What a strong answer covers" }));

    expect(screen.getByText("Name the trade-off.")).toBeTruthy();
    expect(screen.getAllByText("Why not batch?")).toHaveLength(1);
  });
});
