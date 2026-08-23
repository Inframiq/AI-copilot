import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResumeContent } from "@career-copilot/types";

// ── Mock apiClient before importing the store ──────────────────────────────
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    updateResume: vi.fn().mockResolvedValue({}),
    generatePdf: vi.fn().mockResolvedValue({ signed_url: "https://example.com/resume.pdf" }),
  },
}));

// Import after mock is registered
import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

const SAMPLE_CONTENT: ResumeContent = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [
    {
      company: "Acme Corp",
      title: "Engineer",
      start: "2021-01",
      bullets: ["Did things"],
    },
  ],
  education: [{ institution: "MIT", degree: "BSc CS", year: "2021" }],
  skills: ["TypeScript", "React"],
};

describe("useResumeStore", () => {
  beforeEach(() => {
    // Reset store state between tests
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("setResume populates state and clears dirty flag", () => {
    useResumeStore
      .getState()
      .setResume("resume-123", SAMPLE_CONTENT, "ats_clean");

    const state = useResumeStore.getState();
    expect(state.resumeId).toBe("resume-123");
    expect(state.templateId).toBe("ats_clean");
    expect(state.content).toEqual(SAMPLE_CONTENT);
    expect(state.isDirty).toBe(false);
  });

  it("initial templateId defaults to ats_clean", () => {
    expect(useResumeStore.getState().templateId).toBe("ats_clean");
  });

  it("updateContent merges partial and sets isDirty", () => {
    useResumeStore
      .getState()
      .setResume("resume-123", SAMPLE_CONTENT, "ats_clean");

    useResumeStore
      .getState()
      .updateContent({ skills: ["TypeScript", "React", "Zustand"] });

    const state = useResumeStore.getState();
    expect(state.isDirty).toBe(true);
    expect(state.content?.skills).toEqual([
      "TypeScript",
      "React",
      "Zustand",
    ]);
    // Untouched fields remain
    expect(state.content?.contact.name).toBe("Jane Doe");
  });

  it("auto-save debounce calls updateResume after 2s", async () => {
    vi.useFakeTimers();

    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");

    useResumeStore
      .getState()
      .updateContent({ skills: ["Vitest"] });

    expect(apiClient.updateResume).not.toHaveBeenCalled();

    // Fast-forward past debounce
    await vi.runAllTimersAsync();

    expect(apiClient.updateResume).toHaveBeenCalledOnce();
    expect(apiClient.updateResume).toHaveBeenCalledWith(
      "resume-abc",
      expect.objectContaining({ content: expect.any(Object) })
    );
    // isDirty cleared after save
    expect(useResumeStore.getState().isDirty).toBe(false);

    vi.useRealTimers();
  });

  it("rapid updateContent calls are debounced into a single save", async () => {
    vi.useFakeTimers();

    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");

    useResumeStore.getState().updateContent({ skills: ["A"] });
    useResumeStore.getState().updateContent({ skills: ["A", "B"] });
    useResumeStore.getState().updateContent({ skills: ["A", "B", "C"] });

    await vi.runAllTimersAsync();

    // Only one API call despite three updates
    expect(apiClient.updateResume).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("resetStore clears all state", () => {
    useResumeStore
      .getState()
      .setResume("resume-123", SAMPLE_CONTENT, "ats_modern");
    useResumeStore.getState().setPdfSignedUrl("https://example.com/a.pdf");
    useResumeStore.getState().resetStore();

    const state = useResumeStore.getState();
    expect(state.resumeId).toBeNull();
    expect(state.content).toBeNull();
    expect(state.templateId).toBe("ats_clean");
    expect(state.isDirty).toBe(false);
    expect(state.pdfSignedUrl).toBeNull();
  });

  it("setTemplateId updates templateId and sets isDirty", () => {
    useResumeStore
      .getState()
      .setResume("resume-123", SAMPLE_CONTENT, "ats_clean");

    useResumeStore.getState().setTemplateId("ats_modern");

    const state = useResumeStore.getState();
    expect(state.templateId).toBe("ats_modern");
    expect(state.isDirty).toBe(true);
  });

  it("setPdfSignedUrl stores the URL", () => {
    useResumeStore
      .getState()
      .setPdfSignedUrl("https://cdn.example.com/r.pdf");
    expect(useResumeStore.getState().pdfSignedUrl).toBe(
      "https://cdn.example.com/r.pdf"
    );
  });

  it("isSaving is true while the debounced save is in flight, then false on success", async () => {
    vi.useFakeTimers();
    let resolveSave!: () => void;
    vi.mocked(apiClient.updateResume).mockReturnValueOnce(
      new Promise((resolve) => { resolveSave = () => resolve({} as any); })
    );

    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useResumeStore.getState().updateContent({ skills: ["Vitest"] });

    await vi.advanceTimersByTimeAsync(2000);
    expect(useResumeStore.getState().isSaving).toBe(true);

    resolveSave();
    await vi.runAllTimersAsync();
    expect(useResumeStore.getState().isSaving).toBe(false);
    expect(useResumeStore.getState().saveError).toBeNull();

    vi.useRealTimers();
  });

  it("records saveError with a message when the save fails, without throwing out of the debounce", async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.updateResume).mockRejectedValueOnce(new Error("Network error"));

    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useResumeStore.getState().updateContent({ skills: ["Vitest"] });

    // Must not reject/throw unhandled even though saveNow() itself re-throws —
    // _triggerAutoSave's debounced call swallows it after recording state.
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow();

    const state = useResumeStore.getState();
    expect(state.isSaving).toBe(false);
    expect(state.saveError).toBe("Network error");
    // The edit is still unsaved — a failed save must not silently mark it clean.
    expect(state.isDirty).toBe(true);

    vi.useRealTimers();
  });

  it("a new edit clears a previous saveError optimistically", async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.updateResume).mockRejectedValueOnce(new Error("Network error"));

    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useResumeStore.getState().updateContent({ skills: ["Vitest"] });
    await vi.runAllTimersAsync();
    expect(useResumeStore.getState().saveError).toBe("Network error");

    vi.mocked(apiClient.updateResume).mockResolvedValueOnce({} as any);
    useResumeStore.getState().updateContent({ skills: ["Vitest", "Retry"] });
    expect(useResumeStore.getState().saveError).toBeNull();

    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it("saveNow can be called directly to retry after a failure", async () => {
    vi.mocked(apiClient.updateResume).mockRejectedValueOnce(new Error("Network error"));
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useResumeStore.getState().updateContent({ skills: ["Vitest"] });

    await expect(useResumeStore.getState().saveNow()).rejects.toThrow("Network error");
    expect(useResumeStore.getState().saveError).toBe("Network error");

    vi.mocked(apiClient.updateResume).mockResolvedValueOnce({} as any);
    await useResumeStore.getState().saveNow();
    expect(useResumeStore.getState().saveError).toBeNull();
    expect(useResumeStore.getState().isDirty).toBe(false);
  });
});
