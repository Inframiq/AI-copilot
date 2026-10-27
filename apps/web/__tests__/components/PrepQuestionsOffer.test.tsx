// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getJdDetails: vi.fn(),
    getSubscription: vi.fn(),
    generateJdPrepQuestions: vi.fn(async () => ({ session_id: "run-1", questions_total: 9 })),
    getPlans: vi.fn(async () => ({
      plans: [{ id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true, features: [] }],
    })),
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

    const dialog = await screen.findByRole("dialog", { name: "Make interview questions?" });
    expect(dialog).toHaveTextContent(/For Platform Engineer, built from the résumé you saved/);
    // What the set covers — the three kinds the Interview Center labels.
    expect(screen.getByRole("list", { name: "What the set covers" })).toHaveTextContent(
      /From your résumé.*From the job.*Bridging a gap/,
    );
    expect(dialog).toHaveTextContent(/Costs\s*5 credits/);
    expect(await screen.findByText("40 → 35 left after")).toBeInTheDocument();
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

  it("short of credits, offers Premium instead of a set it can't make", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(
      { plan: "free", credits_remaining: 3, costs: { prep_questions: 5 } } as never,
    );
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-1", title: "" });
    renderOffer();

    expect(await screen.findByText("You have 3 · 2 short")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make questions/ })).toBeNull();
    // Price and allowance from the server's plan catalog.
    expect(await screen.findByText("Premium · $5 a month")).toBeInTheDocument();
    expect(screen.getByText(/600 credits every 30 days/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade to Premium/ })).toHaveAttribute("href", "/plans");
  });

  it("short of credits on Premium, offers to renew instead of upgrading", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "premium", status: "active", credits_remaining: 3, credits_allotment: 600, renews: true,
      current_period_end: "2026-11-12T00:00:00Z", costs: { prep_questions: 5 },
    } as never);
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-1", title: "" });
    renderOffer();

    expect(await screen.findByRole("link", { name: /Renew Premium/ })).toHaveAttribute("href", "/plans");
    expect(screen.getByText(/otherwise they refill on/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Upgrade/ })).toBeNull();
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

  it("doesn't ask when the job's set was made from this very résumé, on another run", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(
      details({ session_id: "run-2", questions_total: 9, questions_session_id: "run-1", questions_match_resume: true }) as never,
    );
    offerPrepQuestions({ jdId: "jd-1", sessionId: null, title: "" });
    renderOffer();

    await waitFor(() => expect(usePrepQuestionsStore.getState().offer).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says a new set replaces the job's current one, made from an earlier résumé", async () => {
    vi.mocked(apiClient.getJdDetails).mockResolvedValue(
      details({
        session_id: "run-2", questions_total: 9, questions_practiced: 4, questions_session_id: "run-1",
        questions_match_resume: false,
      }) as never,
    );
    offerPrepQuestions({ jdId: "jd-1", sessionId: "run-2", title: "" });
    renderOffer();

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      /Replaces this job's current 9 questions, made from an earlier résumé \(4 practiced\)/,
    );
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
