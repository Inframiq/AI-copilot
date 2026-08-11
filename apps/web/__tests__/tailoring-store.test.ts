import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TailorOut, ResumeContent, JobDescription } from "@career-copilot/types";

// ── Mock apiClient ────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted, so the factory must NOT reference outer variables.
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    tailorResume: vi.fn(),
    updateResume: vi.fn().mockResolvedValue({}),
    createResume: vi.fn(),
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
  company_keywords: [],
  suggested_skills: [],
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
      50,
      undefined,
      []
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
      50,
      undefined,
      []
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

  it("runTailoring populates pendingContent for review, without touching the resume store or backend", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");

    await useTailoringStore.getState().runTailoring("resume-abc");

    // Tailored content is staged for review, not written into the resume store.
    expect(useTailoringStore.getState().pendingContent?.skills).toEqual([
      "TypeScript",
      "React",
    ]);
    expect(useResumeStore.getState().content).toEqual(SAMPLE_CONTENT);
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    expect(apiClient.generatePdf).not.toHaveBeenCalled();
  });

  it("generatePreview merges accepted bullets and renders a preview without persisting", async () => {
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.tailorResume).mockResolvedValueOnce({
      ...mockTailorResult,
      tailored_content: {
        ...mockTailorResult.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    await useTailoringStore.getState().generatePreview("resume-abc");

    expect(apiClient.generatePdf).toHaveBeenCalledWith(
      "resume-abc",
      "ats_clean",
      expect.objectContaining({
        experience: [expect.objectContaining({ bullets: ["Did stuff, tailored"] })],
      })
    );
    // Nothing persisted, and the original resume is untouched.
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    expect(useResumeStore.getState().content).toEqual(original);
    expect(useTailoringStore.getState().previewPdfUrl).toBe(
      "https://example.com/tailored.pdf"
    );
  });

  it("saveTailoredResume('update') persists the merged content to the same resume", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    await useTailoringStore.getState().runTailoring("resume-abc");
    await useTailoringStore.getState().generatePreview("resume-abc");

    const targetId = await useTailoringStore.getState().saveTailoredResume("resume-abc", "update");

    expect(targetId).toBe("resume-abc");
    expect(apiClient.updateResume).toHaveBeenCalledWith(
      "resume-abc",
      expect.objectContaining({ content: expect.any(Object) })
    );
    // Skills are opt-in via the suggested-skills chips, not a blind copy of
    // the AI's full tailored skill list — none were accepted here, so the
    // original (empty) skill list carries through unchanged.
    expect(useResumeStore.getState().content?.skills).toEqual([]);
    expect(useTailoringStore.getState().previewPdfUrl).toBeNull();
    expect(useTailoringStore.getState().pendingContent).toBeNull();
  });

  it("saveTailoredResume('new') creates a separate resume and leaves the original untouched", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.createResume).mockResolvedValueOnce({
      id: "resume-new",
      user_id: "user-1",
      title: "Tailored Resume",
      content: SAMPLE_CONTENT,
      template_id: "ats_clean",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    await useTailoringStore.getState().generatePreview("resume-abc");

    const targetId = await useTailoringStore.getState().saveTailoredResume(
      "resume-abc",
      "new",
      "Resume — Acme"
    );

    expect(targetId).toBe("resume-new");
    expect(apiClient.createResume).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Resume — Acme", content: expect.any(Object) })
    );
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    // The original resume in the store is untouched.
    expect(useResumeStore.getState().resumeId).toBe("resume-abc");
    expect(useResumeStore.getState().content).toEqual(SAMPLE_CONTENT);
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

  it("setPrioritySkills and togglePrioritySkill manage the priority list", () => {
    useTailoringStore.getState().setPrioritySkills(["Kubernetes", "Terraform"]);
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Kubernetes", "Terraform"]);

    useTailoringStore.getState().togglePrioritySkill("Kubernetes"); // already present → removed
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Terraform"]);

    useTailoringStore.getState().togglePrioritySkill("Docker"); // absent → added
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Terraform", "Docker"]);
  });

  it("runTailoring forwards the current prioritySkills to apiClient.tailorResume", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      50,
      undefined,
      ["Kubernetes"]
    );
  });

  it("runTailoring auto-accepts skill_add decisions for priority skills present in the result", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);
    vi.mocked(apiClient.tailorResume).mockResolvedValueOnce({
      ...mockTailorResult,
      suggested_skills: ["Kubernetes", "Docker"],
    });

    await useTailoringStore.getState().runTailoring("resume-abc");

    const decisions = useTailoringStore.getState().bulletDecisions;
    // The user's pick is pre-accepted...
    expect(decisions["skill_add:Kubernetes"]).toBe("accept");
    // ...but an AI-only suggestion the user didn't ask for is not auto-decided.
    expect(decisions["skill_add:Docker"]).toBeUndefined();
  });

  it("resetStore clears prioritySkills", () => {
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);
    useTailoringStore.getState().resetStore();
    expect(useTailoringStore.getState().prioritySkills).toEqual([]);
  });
});
