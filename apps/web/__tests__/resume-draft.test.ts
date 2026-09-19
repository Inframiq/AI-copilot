import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResumeContent } from "@career-copilot/types";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    updateResume: vi.fn().mockResolvedValue({}),
    createResume: vi.fn().mockResolvedValue({ id: "tailored-1" }),
  },
}));

import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

const MASTER: ResumeContent = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [{ company: "Acme", title: "Engineer", start: "2021-01", bullets: ["Did things"] }],
  education: [],
  skills: ["TypeScript"],
};
const TAILORED: ResumeContent = { ...MASTER, skills: ["TypeScript", "Kubernetes"] };

describe("a tailored draft never touches the résumé it came from", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    useResumeStore.getState().setResume("master-1", MASTER, "ats_clean");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not autosave the draft, its edits or its layout onto the master", async () => {
    const store = useResumeStore.getState();
    store.startDraft(TAILORED, "jd-1");
    store.updateContent({ summary: "Edited in the Studio" });
    store.setTemplateId("ats_modern");
    store.setTextSize("body", 1);
    await vi.runAllTimersAsync();
    await useResumeStore.getState().saveNow();

    expect(apiClient.updateResume).not.toHaveBeenCalled();
  });

  it("cancels a save already queued for the master when the draft starts", async () => {
    useResumeStore.getState().updateContent({ summary: "master edit" });
    useResumeStore.getState().startDraft(TAILORED, "jd-1");
    await vi.runAllTimersAsync();

    expect(apiClient.updateResume).not.toHaveBeenCalled();
  });

  it("saves to the JD as a new résumé and then edits that one", async () => {
    const store = useResumeStore.getState();
    store.startDraft(TAILORED, "jd-1");
    store.setTemplateId("ats_modern");

    const id = await useResumeStore.getState().saveDraftToJd("Jane — Acme");

    expect(id).toBe("tailored-1");
    expect(apiClient.createResume).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Jane — Acme",
        content: TAILORED,
        template_id: "ats_modern",
        jd_id: "jd-1",
      }),
    );
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    const after = useResumeStore.getState();
    expect(after.resumeId).toBe("tailored-1");
    expect(after.draftJdId).toBeNull();

    // Autosave is back on — for the JD's copy, never the master.
    after.updateContent({ summary: "later edit" });
    await vi.runAllTimersAsync();
    expect(apiClient.updateResume).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient.updateResume).mock.calls[0][0]).toBe("tailored-1");
  });

  it("discarding restores the master's content and layout", () => {
    const store = useResumeStore.getState();
    store.startDraft(TAILORED, "jd-1");
    store.setTemplateId("ats_modern");
    // Applying twice keeps the original as the base, not the first draft.
    useResumeStore.getState().startDraft({ ...TAILORED, summary: "v2" }, "jd-1");

    useResumeStore.getState().discardDraft();

    const s = useResumeStore.getState();
    expect(s.draftJdId).toBeNull();
    expect(s.content).toEqual(MASTER);
    expect(s.templateId).toBe("ats_clean");
    expect(s.resumeId).toBe("master-1");
  });
});
