import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TailorOut, ResumeContent } from "@career-copilot/types";

// ── Mock apiClient ────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted, so the factory must NOT reference outer variables.
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    tailorResume: vi.fn(),
    updateResume: vi.fn().mockResolvedValue({}),
  },
}));

const mockTailorResult: TailorOut = {
  session_id: "session-xyz",
  resume_id: "resume-abc",
  jd_id: "jd-001",
  ats_score_before: 60,
  ats_score_after: 82,
  matched_skills: ["TypeScript", "React"],
  missing_skills: ["GraphQL"],
  tailored_content: {
    contact: { name: "Jane Doe", email: "jane@example.com" },
    experience: [],
    education: [],
    skills: ["TypeScript", "React"],
  },
  humanize_level: 50,
};

import { useTailoringStore } from "../stores/tailoring-store";
import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

const SAMPLE_CONTENT: ResumeContent = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [],
  education: [],
  skills: [],
};

describe("useTailoringStore", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    // Default: tailorResume resolves with the mock result
    vi.mocked(apiClient.tailorResume).mockResolvedValue(mockTailorResult);
    vi.mocked(apiClient.updateResume).mockResolvedValue({} as any);
  });

  it("initial state has correct defaults", () => {
    const state = useTailoringStore.getState();
    expect(state.jdId).toBeNull();
    expect(state.jdText).toBe("");
    expect(state.sessionId).toBeNull();
    expect(state.atsScore).toBeNull();
    expect(state.matchedSkills).toEqual([]);
    expect(state.missingSkills).toEqual([]);
    expect(state.humanizeLevel).toBe(50);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("setJd updates jdId and jdText", () => {
    useTailoringStore.getState().setJd("jd-001", "We need TypeScript engineers");
    const state = useTailoringStore.getState();
    expect(state.jdId).toBe("jd-001");
    expect(state.jdText).toBe("We need TypeScript engineers");
  });

  it("setHumanizeLevel updates humanizeLevel", () => {
    useTailoringStore.getState().setHumanizeLevel(75);
    expect(useTailoringStore.getState().humanizeLevel).toBe(75);
  });

  it("runTailoring succeeds and hydrates session state", async () => {
    // Set up resume store
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "We need TypeScript engineers");

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      50
    );

    const state = useTailoringStore.getState();
    expect(state.sessionId).toBe("session-xyz");
    expect(state.atsScore).toBe(82);
    expect(state.matchedSkills).toEqual(["TypeScript", "React"]);
    expect(state.missingSkills).toEqual(["GraphQL"]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("runTailoring without jdId sets error and does not call API", async () => {
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(apiClient.tailorResume).not.toHaveBeenCalled();
    expect(useTailoringStore.getState().error).toBe(
      "No job description selected"
    );
  });

  it("runTailoring hydrates resume store content with tailored_content", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");

    await useTailoringStore.getState().runTailoring("resume-abc");

    // Resume store should now reflect the tailored content
    const content = useResumeStore.getState().content;
    expect(content?.skills).toEqual(["TypeScript", "React"]);
  });

  it("runTailoring handles API errors gracefully", async () => {
    vi.mocked(apiClient.tailorResume).mockRejectedValueOnce(
      new Error("Server error")
    );

    useTailoringStore.getState().setJd("jd-001", "raw text");

    await useTailoringStore.getState().runTailoring("resume-abc");

    const state = useTailoringStore.getState();
    expect(state.error).toBe("Server error");
    expect(state.isLoading).toBe(false);
    expect(state.sessionId).toBeNull();
  });

  it("resetStore clears all fields", () => {
    useTailoringStore.getState().setJd("jd-001", "text");
    useTailoringStore.getState().setHumanizeLevel(80);
    useTailoringStore.getState().resetStore();

    const state = useTailoringStore.getState();
    expect(state.jdId).toBeNull();
    expect(state.humanizeLevel).toBe(50);
  });
});
