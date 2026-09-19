// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted, so the spy has to be created inside the factory and
// pulled back out afterwards.
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    projectScore: vi.fn(async () => ({
      projected_score: 70,
      fix_deltas: { f1: 0, f2: 9 },
      bullet_deltas: { exp0_b0: 18 },
    })),
  },
}));

import { apiClient } from "../lib/api-client";
import { useTailoringStore } from "../stores/tailoring-store";
import { useResumeStore } from "../stores/resume-store";

const projectScore = vi.mocked(apiClient.projectScore);

const CONTENT = {
  contact: { name: "A" }, summary: "S",
  experience: [{ title: "E", company: "X", bullets: ["b"] }],
  education: [], skills: ["Python"],
};

beforeEach(() => {
  vi.clearAllMocks();
  useTailoringStore.getState().resetStore();
  useResumeStore.getState().resetStore();
  useResumeStore.setState({ content: CONTENT } as never);
  useTailoringStore.setState({
    sessionId: "s1",
    pendingContent: CONTENT,
    atsFixes: [
      { id: "f1", type: "skill", text: "Kubernetes", gap: "Kubernetes", importance: "high", score_delta: 27, grounded: true },
      { id: "f2", type: "skill", text: "Terraform", gap: "Terraform", importance: "high", score_delta: 27, grounded: true },
    ],
  } as never);
});

describe("live fix deltas", () => {
  it("stores what each fix is worth right now, not what it was worth at pipeline time", async () => {
    useTailoringStore.getState().refreshProjectedScore();
    await vi.waitFor(() => expect(projectScore).toHaveBeenCalled(), { timeout: 2000 });
    await vi.waitFor(() =>
      expect(useTailoringStore.getState().fixDeltas).toEqual({ f1: 0, f2: 9 }),
    );
  });

  it("keeps the last live values when a refresh fails", async () => {
    useTailoringStore.getState().refreshProjectedScore();
    await vi.waitFor(() => expect(useTailoringStore.getState().fixDeltas.f2).toBe(9));
    projectScore.mockRejectedValueOnce(new Error("boom"));
    useTailoringStore.getState().refreshProjectedScore();
    await vi.waitFor(() => expect(useTailoringStore.getState().projectedScoreStale).toBe(true));
    // Blanking them would make every badge read +0 on a transient failure.
    expect(useTailoringStore.getState().fixDeltas.f2).toBe(9);
  });

  it("starts empty, so the pipeline value is what shows until the first tick lands", () => {
    expect(useTailoringStore.getState().fixDeltas).toEqual({});
  });

  it("stores the live value for each rewritten bullet too", async () => {
    useTailoringStore.getState().refreshProjectedScore();
    await vi.waitFor(() =>
      expect(useTailoringStore.getState().bulletDeltas).toEqual({ exp0_b0: 18 }),
    );
  });

  // The session stores only the tailored side of each rewrite, so without the
  // candidate's own text the server cannot score "this rewrite turned off"
  // and the badge stays frozen at its pipeline value.
  it("sends the candidate's own text for each rewritten bullet", async () => {
    useTailoringStore.setState({
      pendingContent: { ...CONTENT, experience: [{ title: "E", company: "X", bullets: ["rewritten"] }] },
    } as never);
    useTailoringStore.getState().refreshProjectedScore();
    await vi.waitFor(() => expect(projectScore).toHaveBeenCalled());
    const originals = projectScore.mock.calls[0][4];
    expect(originals).toEqual({ exp0_b0: "b" });
  });
});
