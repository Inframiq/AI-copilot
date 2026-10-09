import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: { generateJdPrepQuestions: vi.fn() },
}));

import { usePrepQuestionsStore, startPrepQuestions } from "../stores/prep-questions-store";
import { apiClient } from "../lib/api-client";

describe("startPrepQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePrepQuestionsStore.setState({ pending: {}, errors: {} });
  });

  it("shows the JD as preparing until the questions exist, then refreshes every view of them", async () => {
    let finish!: (v: unknown) => void;
    vi.mocked(apiClient.generateJdPrepQuestions).mockReturnValue(new Promise((r) => (finish = r)) as never);
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    const run = startPrepQuestions(qc, "jd-1", { sessionId: "run-7", title: "Backend Engineer" });
    expect(usePrepQuestionsStore.getState().pending).toEqual({ "jd-1": "Backend Engineer" });
    expect(apiClient.generateJdPrepQuestions).toHaveBeenCalledWith("jd-1", "run-7");
    // Lists are refreshed when the questions exist — not before, which is
    // what left them empty and cached.
    expect(invalidate).not.toHaveBeenCalled();

    finish({ session_id: "run-7", questions_total: 10 });
    await run;

    expect(usePrepQuestionsStore.getState().pending).toEqual({});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["jdDetails", "jd-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["myQuestions"] });
  });

  it("starts nothing new while the same JD is already preparing", async () => {
    vi.mocked(apiClient.generateJdPrepQuestions).mockReturnValue(new Promise(() => {}) as never);
    const qc = new QueryClient();
    void startPrepQuestions(qc, "jd-1");
    await startPrepQuestions(qc, "jd-1");
    expect(apiClient.generateJdPrepQuestions).toHaveBeenCalledTimes(1);
  });

  it("keeps the reason when it fails, and never throws", async () => {
    vi.mocked(apiClient.generateJdPrepQuestions).mockRejectedValue(new Error("Model timed out"));
    await expect(startPrepQuestions(new QueryClient(), "jd-1")).resolves.toBeUndefined();
    expect(usePrepQuestionsStore.getState().errors).toEqual({ "jd-1": "Model timed out" });
    expect(usePrepQuestionsStore.getState().pending).toEqual({});
  });
});
