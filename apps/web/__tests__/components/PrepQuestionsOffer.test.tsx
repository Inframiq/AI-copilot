// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getJdDetails: vi.fn(),
    getSubscription: vi.fn(),
    generateJdPrepQuestions: vi.fn(async () => ({ session_id: "run-1", questions_total: 9 })),
  },
}));

import { PrepQuestionsOffer } from "../../components/interview/PrepQuestionsOffer";
import { offerPrepQuestions, usePrepQuestionsStore } from "../../stores/prep-questions-store";
import { apiClient } from "../../lib/api-client";

function details(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "run-1", ats_score: 70, resume_id: "r1", resume_title: "R", resume_pdf_url: null,
    session_created_at: null, questions_total: 0, questions_practiced: 0, questions_session_id: null,
    resume_saved: true, ...overrides,
  };
}

function renderOffer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PrepQuestionsOffer />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  usePrepQuestionsStore.setState({ pending: {}, errors: {}, offer: null });
  vi.mocked(apiClient.getJdDetails).mockResolvedValue(details() as never);
  vi.mocked(apiClient.getSubscription).mockResolvedValue(
    { credits_remaining: 40, costs: { prep_questions: 5 } } as never,
  );
});

describe("PrepQuestionsOffer", () => {
  it("shows nothing until a save asks", () => {
    renderOffer();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks, with the price and the balance, and makes the set only on yes", async () => {
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-1", title: "Platform Engineer" });
    renderOffer();

    const dialog = await screen.findByRole("dialog", { name: "Make interview questions for this job?" });
    expect(dialog).toHaveTextContent(/for Platform Engineer/);
    expect(dialog).toHaveTextContent(/Costs 5 credits/);
    expect(await screen.findByText("Balance: 40 credits.")).toBeInTheDocument();
    expect(apiClient.generateJdPrepQuestions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Make questions · 5 credits" }));
    await waitFor(() => expect(apiClient.generateJdPrepQuestions).toHaveBeenCalledWith("jd-1", "run-1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["Not now", () => fireEvent.click(screen.getByRole("button", { name: "Not now" }))],
    ["the X", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
  ])("%s means no: nothing is made or charged", async (_label, dismiss) => {
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-1", title: "Platform Engineer" });
    renderOffer();
    await screen.findByRole("dialog");

    dismiss();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(usePrepQuestionsStore.getState().offer).toBeNull();
    expect(apiClient.generateJdPrepQuestions).not.toHaveBeenCalled();
  });

  it("can't be accepted without enough credits, and says so", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(
      { credits_remaining: 3, costs: { prep_questions: 5 } } as never,
    );
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-1", title: "" });
    renderOffer();

    expect(await screen.findByText("Not enough credits: 5 needed, 3 left.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make questions · 5 credits" })).toBeDisabled();
  });

  it("doesn't ask when the run this résumé came from already has a set", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(
      details({ questions_total: 9, questions_session_id: "run-1" }) as never,
    );
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-1", title: "" });
    renderOffer();

    await waitFor(() => expect(usePrepQuestionsStore.getState().offer).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks when only an older run has a set", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(
      details({ session_id: "run-2", questions_total: 9, questions_session_id: "run-1" }) as never,
    );
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-2", title: "" });
    renderOffer();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
