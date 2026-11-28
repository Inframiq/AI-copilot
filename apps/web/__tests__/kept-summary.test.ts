// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Resume, ResumeContent } from "@career-copilot/types";

vi.mock("@/lib/api-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { updateResume: vi.fn(), getResume: vi.fn() } };
});

import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";
import { queryClient } from "../lib/query-client";
import { isKeptSummary, keepSummary, sameSummary } from "../lib/kept-summary";

const CONTENT: ResumeContent = { contact: { name: "Jane", email: "" }, experience: [], education: [], skills: ["Go"] };
const V1 = "2026-11-28T00:00:01Z";
const saved = (updated_at: string): Resume => ({
  id: "r1", user_id: "u1", title: "Mine", template_id: "ats_clean", content: CONTENT,
  line_spacing: 1.15, paragraph_spacing: 12, font_choice: "sans", accent_color: null,
  heading_size_delta: 0, body_size_delta: 0, created_at: V1, updated_at,
});
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const updateResume = vi.mocked(apiClient.updateResume);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  queryClient.clear();
  useResumeStore.getState().resetStore();
  useResumeStore.getState().setResume("r1", CONTENT, "ats_clean", undefined, undefined, undefined, undefined, undefined, undefined, V1);
});

describe("kept summaries", () => {
  it("remembers a version by its words, spacing aside", () => {
    expect(isKeptSummary("A long one.")).toBe(false);
    keepSummary("A  long\none. ");
    expect(isKeptSummary("A long one.")).toBe(true);
    expect(isKeptSummary("A long one, edited.")).toBe(false);
    expect(sameSummary("a  b", "a b")).toBe(true);
  });

  // The user's call (2026-11-28): after the note, they may keep their own
  // version as it is.
  it("Save my version saves a summary past 100 words in the Builder; an edit to it asks again", async () => {
    const long = words(130);
    useResumeStore.getState().updateContent({ summary: long });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow(/this one has 130/);
    expect(updateResume).not.toHaveBeenCalled();

    updateResume.mockResolvedValueOnce(saved("2026-11-28T00:00:02Z"));
    await useResumeStore.getState().keepLongSummary();
    expect(updateResume).toHaveBeenCalledTimes(1);
    expect(updateResume.mock.calls[0][1].content?.summary).toBe(long);
    expect(useResumeStore.getState().saveError).toBeNull();

    // Other edits keep saving with that version.
    updateResume.mockResolvedValueOnce(saved("2026-11-28T00:00:03Z"));
    useResumeStore.getState().updateContent({ skills: ["Rust"] });
    await useResumeStore.getState().saveNow();
    expect(updateResume).toHaveBeenCalledTimes(2);

    // A new version past the standard is asked about again.
    useResumeStore.getState().updateContent({ summary: `${long} more` });
    await expect(useResumeStore.getState().saveNow()).rejects.toThrow(/this one has 131/);
    expect(updateResume).toHaveBeenCalledTimes(2);
  });

  it("a kept summary stays kept when the résumé is opened again", () => {
    const long = words(130);
    keepSummary(long);
    useResumeStore.getState().setResume("r9", { ...CONTENT, summary: long }, "ats_clean");
    expect(useResumeStore.getState().keptSummary).toBe(long);
    useResumeStore.getState().setResume("r8", { ...CONTENT, summary: words(120) }, "ats_clean");
    expect(useResumeStore.getState().keptSummary).toBeNull();
  });
});
