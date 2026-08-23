import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import type { ResumeContent } from "@career-copilot/types";

const DEFAULT_LINE_SPACING = 1.25;
const DEFAULT_PARAGRAPH_SPACING = 12;

interface ResumeState {
  resumeId: string | null;
  content: ResumeContent | null;
  templateId: string;
  /** CSS line-height multiplier applied when rendering this resume's PDF. */
  lineSpacing: number;
  /** Space in px after each bullet list / summary / plain list. */
  paragraphSpacing: number;
  isDirty: boolean;
  /** True while the debounced auto-save's PATCH request is actually in flight. */
  isSaving: boolean;
  /** Message from the most recent failed save, cleared on the next edit or
   * successful save — surfaced in the UI so a failed save is never silent. */
  saveError: string | null;
  pdfSignedUrl: string | null;
  _saveTimer: ReturnType<typeof setTimeout> | null;

  setResume: (
    id: string,
    content: ResumeContent,
    templateId: string,
    lineSpacing?: number,
    paragraphSpacing?: number
  ) => void;
  updateContent: (partial: Partial<ResumeContent>) => void;
  setTemplateId: (id: string) => void;
  setSpacing: (lineSpacing: number, paragraphSpacing: number) => void;
  setPdfSignedUrl: (url: string | null) => void;
  resetStore: () => void;
  /** Bypasses the debounce and persists immediately — for callers that need
   *  the backend to be caught up before doing something else (e.g. a PDF
   *  regen right after AI tailoring writes new content). */
  saveNow: () => Promise<void>;
  /** Internal — exposed for testing */
  _triggerAutoSave: () => void;
}

const AUTO_SAVE_DELAY_MS = 2000;

export const useResumeStore = create<ResumeState>((set, get) => ({
  resumeId: null,
  content: null,
  templateId: "ats_clean",
  lineSpacing: DEFAULT_LINE_SPACING,
  paragraphSpacing: DEFAULT_PARAGRAPH_SPACING,
  isDirty: false,
  isSaving: false,
  saveError: null,
  pdfSignedUrl: null,
  _saveTimer: null,

  setResume: (id, content, templateId, lineSpacing, paragraphSpacing) =>
    set({
      resumeId: id,
      content,
      templateId,
      lineSpacing: lineSpacing ?? DEFAULT_LINE_SPACING,
      paragraphSpacing: paragraphSpacing ?? DEFAULT_PARAGRAPH_SPACING,
      isDirty: false,
      isSaving: false,
      saveError: null,
      pdfSignedUrl: null,
    }),

  updateContent: (partial) => {
    const current = get().content;
    set({
      content: current ? { ...current, ...partial } : (partial as ResumeContent),
      isDirty: true,
      saveError: null,
    });
    get()._triggerAutoSave();
  },

  setTemplateId: (id) => {
    set({ templateId: id, isDirty: true, saveError: null });
    get()._triggerAutoSave();
  },

  setSpacing: (lineSpacing, paragraphSpacing) => {
    set({ lineSpacing, paragraphSpacing, isDirty: true, saveError: null });
    get()._triggerAutoSave();
  },

  setPdfSignedUrl: (url) => set({ pdfSignedUrl: url }),

  resetStore: () => {
    const timer = get()._saveTimer;
    if (timer !== null) clearTimeout(timer);
    set({
      resumeId: null,
      content: null,
      templateId: "ats_clean",
      lineSpacing: DEFAULT_LINE_SPACING,
      paragraphSpacing: DEFAULT_PARAGRAPH_SPACING,
      isDirty: false,
      isSaving: false,
      saveError: null,
      pdfSignedUrl: null,
      _saveTimer: null,
    });
  },

  _triggerAutoSave: () => {
    const prev = get()._saveTimer;
    if (prev !== null) clearTimeout(prev);
    const timer = setTimeout(() => {
      // saveNow() already records any failure into saveError below — this
      // catch exists only so a debounced call nobody awaits doesn't surface
      // as an unhandled promise rejection.
      get().saveNow().catch(() => {});
    }, AUTO_SAVE_DELAY_MS);
    set({ _saveTimer: timer });
  },

  saveNow: async () => {
    const timer = get()._saveTimer;
    if (timer !== null) clearTimeout(timer);
    set({ _saveTimer: null });

    const { resumeId, content, templateId, lineSpacing, paragraphSpacing } = get();
    if (!resumeId || !content) return;
    set({ isSaving: true });
    try {
      await apiClient.updateResume(resumeId, {
        content,
        template_id: templateId,
        line_spacing: lineSpacing,
        paragraph_spacing: paragraphSpacing,
      });
      set({ isDirty: false, isSaving: false, saveError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      console.error("Save failed:", err);
      set({ isSaving: false, saveError: message });
      throw err;
    }
  },
}));
