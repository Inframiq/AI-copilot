import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TailorOut, ResumeContent, JobDescription } from "@career-copilot/types";

// ── Mock apiClient ────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted, so the factory must NOT reference outer variables.
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    tailorResume: vi.fn(),
    updateResume: vi.fn().mockResolvedValue({}),
    generatePdf: vi.fn().mockResolvedValue({ signed_url: "https://example.com/tailored.pdf" }),
    createJd: vi.fn(),
  },
}));

const mockTailorResult: TailorOut = {
  session_id: "session-xyz",
  ats_score: 82,
  matched_skills: ["TypeScript", "React"],
  missing_skills: ["GraphQL"],
  tailored_content: {
    contact: { name: "Jane Doe", email: "jane@example.com" },
    experience: [],
    education: [],
    skills: ["TypeScript", "React"],
  },
  questions: [],
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
    vi.mocked(apiClient.generatePdf).mockResolvedValue({
      signed_url: "https://example.com/tailored.pdf",
    });
    vi.mocked(apiClient.createJd).mockResolvedValue({
      id: "jd-created-001",
      user_id: "user-1",
      title: "Senior TypeScript Engineer",
      raw_text: "Senior TypeScript Engineer\nWe need 5+ years of React.",
      parsed_skills: [],
      status: "applied",
      created_at: new Date().toISOString(),
    } satisfies JobDescription);
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

  it("runTailoring without jdId or jdText sets error and does not call API", async () => {
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(apiClient.tailorResume).not.toHaveBeenCalled();
    expect(apiClient.createJd).not.toHaveBeenCalled();
    expect(useTailoringStore.getState().error).toBe(
      "No job description selected"
    );
  });

  it("runTailoring creates a JD from pasted text when only jdText is set (the editor's JD Context box never has a jdId)", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    // This is what EditorPanel's JD Context textarea does: setJd("", text).
    useTailoringStore.getState().setJd("", "Senior TypeScript Engineer\nWe need 5+ years of React.");

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.createJd).toHaveBeenCalledWith({
      title: "Senior TypeScript Engineer",
      raw_text: "Senior TypeScript Engineer\nWe need 5+ years of React.",
    });
    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-created-001",
      50
    );
    const state = useTailoringStore.getState();
    expect(state.jdId).toBe("jd-created-001");
    expect(state.error).toBeNull();
    expect(state.sessionId).toBe("session-xyz");
  });

  it("runTailoring surfaces an error if creating the JD fails", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("", "Some JD text");
    vi.mocked(apiClient.createJd).mockRejectedValueOnce(new Error("Save failed"));

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.tailorResume).not.toHaveBeenCalled();
    expect(useTailoringStore.getState().error).toBe("Save failed");
    expect(useTailoringStore.getState().isLoading).toBe(false);
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

  it("runTailoring persists tailored content and refreshes the PDF preview", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");

    await useTailoringStore.getState().runTailoring("resume-abc");

    // Content is saved immediately (not left to the debounce) before the
    // PDF is regenerated, since the PDF endpoint reads from the DB.
    expect(apiClient.updateResume).toHaveBeenCalledWith(
      "resume-abc",
      expect.objectContaining({ content: expect.any(Object) })
    );
    expect(apiClient.generatePdf).toHaveBeenCalledWith("resume-abc", "ats_clean");
    expect(useResumeStore.getState().pdfSignedUrl).toBe(
      "https://example.com/tailored.pdf"
    );
  });

  it("runTailoring surfaces tailoring success even if the PDF refresh fails", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.generatePdf).mockRejectedValueOnce(new Error("render failed"));

    await useTailoringStore.getState().runTailoring("resume-abc");

    const state = useTailoringStore.getState();
    expect(state.error).toBeNull();
    expect(state.sessionId).toBe("session-xyz");
    expect(useResumeStore.getState().pdfSignedUrl).toBeNull();
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
