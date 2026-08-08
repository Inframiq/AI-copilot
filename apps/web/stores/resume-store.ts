import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import type { ResumeContent } from "@career-copilot/types";

interface ResumeState {
  resumeId: string | null;
  content: ResumeContent | null;
  templateId: string;
  isDirty: boolean;
  pdfSignedUrl: string | null;
  _saveTimer: ReturnType<typeof setTimeout> | null;

  setResume: (
    id: string,
    content: ResumeContent,
    templateId: string
  ) => void;
  updateContent: (partial: Partial<ResumeContent>) => void;
  setTemplateId: (id: string) => void;
  setPdfSignedUrl: (url: string) => void;
  resetStore: () => void;
  /** Internal — exposed for testing */
  _triggerAutoSave: () => void;
}

const AUTO_SAVE_DELAY_MS = 2000;

export const useResumeStore = create<ResumeState>((set, get) => ({
  resumeId: null,
  content: null,
  templateId: "ats_clean",
  isDirty: false,
  pdfSignedUrl: null,
  _saveTimer: null,

  setResume: (id, content, templateId) =>
    set({
      resumeId: id,
      content,
      templateId,
      isDirty: false,
      pdfSignedUrl: null,
    }),

  updateContent: (partial) => {
    const current = get().content;
    set({
      content: current ? { ...current, ...partial } : (partial as ResumeContent),
      isDirty: true,
    });
    get()._triggerAutoSave();
  },

  setTemplateId: (id) => {
    set({ templateId: id, isDirty: true });
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
      isDirty: false,
      pdfSignedUrl: null,
      _saveTimer: null,
    });
  },

  _triggerAutoSave: () => {
    const prev = get()._saveTimer;
    if (prev !== null) clearTimeout(prev);
    const timer = setTimeout(async () => {
      const { resumeId, content, templateId } = get();
      if (!resumeId || !content) return;
      try {
        await apiClient.updateResume(resumeId, { content, template_id: templateId });
        set({ isDirty: false, _saveTimer: null });
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    }, AUTO_SAVE_DELAY_MS);
    set({ _saveTimer: timer });
  },
}));
