import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Resume, ResumeContent } from "@career-copilot/types";

// The real ApiError and isResumeChanged, so a refusal is recognised exactly
// as it will be in the app; only the network calls are faked.
vi.mock("@/lib/api-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { updateResume: vi.fn(), getResume: vi.fn() },
  };
});

import { useResumeStore } from "../stores/resume-store";
import { apiClient, ApiError } from "../lib/api-client";
import { queryClient } from "../lib/query-client";

const CONTENT: ResumeContent = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [],
  education: [],
  skills: ["TypeScript"],
};

const V1 = "2026-10-12T10:00:00.000001+00:00";
const V2 = "2026-10-12T10:05:00.000002+00:00";
const V3 = "2026-10-12T10:06:00.000003+00:00";

function saved(updated_at: string, content: ResumeContent = CONTENT): Resume {
  return {
    id: "r1", user_id: "u1", title: "Mine", template_id: "ats_clean", content,
    line_spacing: 1.25, paragraph_spacing: 12, font_choice: "sans", accent_color: null,
    heading_size_delta: 0, body_size_delta: 0, created_at: V1, updated_at,
  };
}

function changedOnAnotherDevice(theirs: string) {
  return new ApiError(409, "This résumé was changed on another device.", {
    code: "resume_changed",
    message: "This résumé was changed on another device.",
    updated_at: theirs,
  });
}

const updateResume = vi.mocked(apiClient.updateResume);
const getResume = vi.mocked(apiClient.getResume);

function load() {
  useResumeStore.getState().setResume(
    "r1", CONTENT, "ats_clean", undefined, undefined, undefined, undefined, undefined, undefined, V1,
  );
}

describe("saving a résumé open on more than one device", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    queryClient.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("each save sends the version it has and keeps the one it gets back", async () => {
    load();
    updateResume.mockResolvedValueOnce(saved(V2)).mockResolvedValueOnce(saved(V3));

    useResumeStore.getState().updateContent({ skills: ["Go"] });
    await useResumeStore.getState().saveNow();
    useResumeStore.getState().updateContent({ skills: ["Rust"] });
    await useResumeStore.getState().saveNow();

    expect(updateResume.mock.calls[0][1].expected_updated_at).toBe(V1);
    expect(updateResume.mock.calls[1][1].expected_updated_at).toBe(V2);
    expect(useResumeStore.getState().updatedAt).toBe(V3);
  });

  it("two of this device's saves never overlap — the second waits and sends the first's version", async () => {
    load();
    let finishFirst!: (r: Resume) => void;
    updateResume
      .mockImplementationOnce(() => new Promise((res) => { finishFirst = res; }))
      .mockResolvedValueOnce(saved(V3));

    useResumeStore.getState().updateContent({ skills: ["Go"] });
    const first = useResumeStore.getState().saveNow();
    useResumeStore.getState().updateContent({ skills: ["Rust"] });
    const second = useResumeStore.getState().saveNow();

    await Promise.resolve();
    expect(updateResume).toHaveBeenCalledTimes(1);
    finishFirst(saved(V2));
    await Promise.all([first, second]);

    expect(updateResume).toHaveBeenCalledTimes(2);
    expect(updateResume.mock.calls[1][1].expected_updated_at).toBe(V2);
    expect(updateResume.mock.calls[1][1].content?.skills).toEqual(["Rust"]);
  });

  it("a summary past 80 words isn't saved: the edits stay and the header says why", async () => {
    load();
    const long = Array.from({ length: 330 }, (_, i) => `w${i}`).join(" ");
    useResumeStore.getState().updateContent({ summary: long });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow(/330 words/);
    expect(updateResume).not.toHaveBeenCalled();
    expect(useResumeStore.getState().saveError).toBe("The summary is 330 words. Trim it to 80 or fewer to save.");
    expect(useResumeStore.getState().isDirty).toBe(true);

    // Trimmed, it saves.
    updateResume.mockResolvedValueOnce(saved(V2));
    useResumeStore.getState().updateContent({ summary: "Backend engineer." });
    await useResumeStore.getState().saveNow();
    expect(updateResume).toHaveBeenCalledTimes(1);
    expect(useResumeStore.getState().saveError).toBeNull();
  });

  it("a refused save opens the conflict instead of an error, and keeps the edits unsaved", async () => {
    load();
    updateResume.mockRejectedValueOnce(changedOnAnotherDevice(V2));

    useResumeStore.getState().updateContent({ skills: ["Go"] });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow();

    const s = useResumeStore.getState();
    expect(s.conflictUpdatedAt).toBe(V2);
    expect(s.saveError).toBeNull();
    expect(s.isDirty).toBe(true);
    expect(s.isSaving).toBe(false);
  });

  it("while it asks, nothing saves — not the autosave, not a direct save", async () => {
    vi.useFakeTimers();
    load();
    updateResume.mockRejectedValueOnce(changedOnAnotherDevice(V2));
    useResumeStore.getState().updateContent({ skills: ["Go"] });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow();
    updateResume.mockClear();

    useResumeStore.getState().updateContent({ skills: ["Rust"] });
    await vi.runAllTimersAsync();
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow(/another device/);

    expect(updateResume).not.toHaveBeenCalled();
    expect(useResumeStore.getState().content?.skills).toEqual(["Rust"]);
  });

  it("keep mine saves this copy over exactly the version it was told about", async () => {
    load();
    updateResume.mockRejectedValueOnce(changedOnAnotherDevice(V2)).mockResolvedValueOnce(saved(V3));
    useResumeStore.getState().updateContent({ skills: ["Mine"] });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow();

    await useResumeStore.getState().keepMine();

    expect(updateResume.mock.calls[1][1]).toMatchObject({
      expected_updated_at: V2,
      content: expect.objectContaining({ skills: ["Mine"] }),
    });
    const s = useResumeStore.getState();
    expect(s.conflictUpdatedAt).toBeNull();
    expect(s.isDirty).toBe(false);
    expect(s.updatedAt).toBe(V3);
  });

  it("keep mine asks again if yet another save landed meanwhile", async () => {
    load();
    updateResume
      .mockRejectedValueOnce(changedOnAnotherDevice(V2))
      .mockRejectedValueOnce(changedOnAnotherDevice(V3));
    useResumeStore.getState().updateContent({ skills: ["Mine"] });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow();

    await expect(useResumeStore.getState().keepMine()).rejects.toThrow();
    expect(useResumeStore.getState().conflictUpdatedAt).toBe(V3);
  });

  it("load theirs replaces this copy with the saved one, and a queued autosave doesn't bring the edits back", async () => {
    vi.useFakeTimers();
    load();
    const theirs: ResumeContent = { ...CONTENT, skills: ["Theirs"] };
    updateResume.mockRejectedValueOnce(changedOnAnotherDevice(V2));
    getResume.mockResolvedValueOnce(saved(V2, theirs));
    useResumeStore.getState().updateContent({ skills: ["Mine"] });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow();
    updateResume.mockClear();

    await useResumeStore.getState().loadTheirs();
    await vi.runAllTimersAsync();

    const s = useResumeStore.getState();
    expect(s.content?.skills).toEqual(["Theirs"]);
    expect(s.updatedAt).toBe(V2);
    expect(s.conflictUpdatedAt).toBeNull();
    expect(s.isDirty).toBe(false);
    expect(updateResume).not.toHaveBeenCalled();
  });

  it("a save updates the cached résumé, so reopening it from cache isn't a stale copy", async () => {
    load();
    queryClient.setQueryData(["resume", "r1"], saved(V1));
    queryClient.setQueryData(["resumes"], [saved(V1)]);
    updateResume.mockResolvedValueOnce(saved(V2, { ...CONTENT, skills: ["Go"] }));

    useResumeStore.getState().updateContent({ skills: ["Go"] });
    await useResumeStore.getState().saveNow();

    expect(queryClient.getQueryData<Resume>(["resume", "r1"])?.updated_at).toBe(V2);
    expect(queryClient.getQueryData<Resume[]>(["resumes"])?.[0].updated_at).toBe(V2);
  });

  it("a new résumé loaded on top clears a conflict about the old one", async () => {
    load();
    updateResume.mockRejectedValueOnce(changedOnAnotherDevice(V2));
    useResumeStore.getState().updateContent({ skills: ["Go"] });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow();

    useResumeStore.getState().setResume("r2", CONTENT, "ats_clean");
    expect(useResumeStore.getState().conflictUpdatedAt).toBeNull();
  });
});
