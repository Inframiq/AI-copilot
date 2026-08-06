import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import { useResumeStore } from "@/stores/resume-store";

interface TailoringState {
  jdId: string | null;
  jdText: string;
  sessionId: string | null;
  atsScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  humanizeLevel: number;
  isLoading: boolean;
  error: string | null;

  setJd: (id: string, text: string) => void;
  setHumanizeLevel: (n: number) => void;
  runTailoring: (resumeId: string) => Promise<void>;
  resetStore: () => void;
}

export const useTailoringStore = create<TailoringState>((set, get) => ({
  jdId: null,
  jdText: "",
  sessionId: null,
  atsScore: null,
  matchedSkills: [],
  missingSkills: [],
  humanizeLevel: 50,
  isLoading: false,
  error: null,

  setJd: (id, text) => set({ jdId: id, jdText: text }),

  setHumanizeLevel: (n) => set({ humanizeLevel: n }),

  runTailoring: async (resumeId: string) => {
    const { jdId, humanizeLevel } = get();
    if (!jdId) {
      set({ error: "No job description selected" });
      return;
    }

    set({
      isLoading: true,
      error: null,
      atsScore: null,
      matchedSkills: [],
      missingSkills: [],
      sessionId: null,
    });
    try {
      const result = await apiClient.tailorResume(
        resumeId,
        jdId,
        humanizeLevel
      );

      set({
        sessionId: result.session_id,
        atsScore: result.ats_score_after,
        matchedSkills: result.matched_skills,
        missingSkills: result.missing_skills,
        isLoading: false,
      });

      // Hydrate the resume store with the tailored content
      if (result.tailored_content) {
        useResumeStore.getState().updateContent(result.tailored_content);
      }
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : "Tailoring failed",
        isLoading: false,
      });
    }
  },

  resetStore: () =>
    set({
      jdId: null,
      jdText: "",
      sessionId: null,
      atsScore: null,
      matchedSkills: [],
      missingSkills: [],
      humanizeLevel: 50,
      isLoading: false,
      error: null,
    }),
}));
