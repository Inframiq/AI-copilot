import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import { useResumeStore } from "@/stores/resume-store";

interface TailoringState {
  jdId: string | null;
  jdText: string;
  companyName: string;
  sessionId: string | null;
  atsScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  companyKeywords: string[];
  humanizeLevel: number;
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;

  setJd: (id: string, text: string) => void;
  setCompanyName: (name: string) => void;
  setHumanizeLevel: (n: number) => void;
  runAnalysis: (resumeId: string) => Promise<void>;
  runTailoring: (resumeId: string) => Promise<void>;
  resetStore: () => void;
}

export const useTailoringStore = create<TailoringState>((set, get) => ({
  jdId: null,
  jdText: "",
  companyName: "",
  sessionId: null,
  atsScore: null,
  matchedSkills: [],
  missingSkills: [],
  companyKeywords: [],
  humanizeLevel: 50,
  isLoading: false,
  isAnalyzing: false,
  error: null,

  setJd: (id, text) => set({ jdId: id, jdText: text }),
  setCompanyName: (name) => set({ companyName: name }),
  setHumanizeLevel: (n) => set({ humanizeLevel: n }),

  // Read-only "Analyze Description" step — computes ATS score / matched /
  // missing skills without touching the resume. Tailoring (which rewrites
  // the resume and regenerates the PDF) only happens when the user
  // explicitly clicks "Tailor Resume" afterward, via runTailoring below.
  runAnalysis: async (resumeId: string) => {
    let { jdId } = get();
    const { jdText, companyName } = get();

    if (!jdId) {
      if (!jdText.trim()) {
        set({ error: "No job description selected" });
        return;
      }
      try {
        const title = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
        const jd = await apiClient.createJd({ title, raw_text: jdText });
        jdId = jd.id;
        set({ jdId });
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : "Failed to save job description" });
        return;
      }
    }

    set({
      isAnalyzing: true,
      error: null,
      atsScore: null,
      matchedSkills: [],
      missingSkills: [],
      companyKeywords: [],
      sessionId: null,
    });
    try {
      const result = await apiClient.analyzeJd(resumeId, jdId, companyName || undefined);
      set({
        atsScore: result.ats_score,
        matchedSkills: result.matched_skills,
        missingSkills: result.missing_skills,
        companyKeywords: result.company_keywords ?? [],
        isAnalyzing: false,
      });
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : "Analysis failed",
        isAnalyzing: false,
      });
    }
  },

  runTailoring: async (resumeId: string) => {
    let { jdId } = get();
    const { jdText, humanizeLevel, companyName } = get();

    // The editor's "paste a JD" box only has raw text, no id — setJd("", text)
    // leaves jdId empty. Create the JD record here instead of requiring the
    // caller to have gone through the JD Analyzer flow first.
    if (!jdId) {
      if (!jdText.trim()) {
        set({ error: "No job description selected" });
        return;
      }
      try {
        const title = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
        const jd = await apiClient.createJd({ title, raw_text: jdText });
        jdId = jd.id;
        set({ jdId });
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : "Failed to save job description" });
        return;
      }
    }

    set({
      isLoading: true,
      error: null,
      atsScore: null,
      matchedSkills: [],
      missingSkills: [],
      companyKeywords: [],
      sessionId: null,
    });
    try {
      const result = await apiClient.tailorResume(
        resumeId,
        jdId,
        humanizeLevel,
        companyName || undefined,
      );

      set({
        sessionId: result.session_id,
        atsScore: result.ats_score,
        matchedSkills: result.matched_skills,
        missingSkills: result.missing_skills,
        companyKeywords: result.company_keywords ?? [],
        isLoading: false,
      });

      // Hydrate the resume store with the tailored content, then regenerate
      // the PDF preview immediately instead of leaving the stale one on
      // screen until the user clicks "Generate PDF" themselves.
      if (result.tailored_content) {
        const resumeStore = useResumeStore.getState();
        resumeStore.updateContent(result.tailored_content);
        try {
          // saveNow bypasses the auto-save debounce — the PDF endpoint reads
          // content from the DB, so the tailored content must be persisted
          // before we ask it to render, not just sitting in local state.
          await resumeStore.saveNow();
          const { signed_url } = await apiClient.generatePdf(
            resumeId,
            useResumeStore.getState().templateId
          );
          useResumeStore.getState().setPdfSignedUrl(signed_url);
        } catch (err) {
          console.error("Post-tailoring PDF refresh failed:", err);
        }
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
      companyName: "",
      sessionId: null,
      atsScore: null,
      matchedSkills: [],
      missingSkills: [],
      companyKeywords: [],
      humanizeLevel: 50,
      isLoading: false,
      isAnalyzing: false,
      error: null,
    }),
}));
