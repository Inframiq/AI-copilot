import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import { useResumeStore } from "@/stores/resume-store";
import type { ResumeContent } from "@career-copilot/types";

// 'accept' = use tailored version, 'reject' = keep original
export type BulletDecision = "accept" | "reject";

export interface BulletChange {
  key: string; // e.g. "exp0_b2" or "skills"
  jobIdx: number; // -1 for skills
  bulletIdx: number; // -1 for skills
  jobTitle: string;
  company: string;
  original: string;
  tailored: string;
}

interface TailoringState {
  jdId: string | null;
  jdText: string;
  companyName: string;
  sessionId: string | null;
  atsScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  companyKeywords: string[];
  suggestedSkills: string[];  // skills Agent 2 suggests — user opts in per chip
  humanizeLevel: number;
  isLoading: boolean;
  isAnalyzing: boolean;
  isApplying: boolean;
  error: string | null;

  // Pending review state — populated after tailoring, cleared after apply/discard
  pendingContent: ResumeContent | null;
  bulletDecisions: Record<string, BulletDecision>;

  setJd: (id: string, text: string) => void;
  setCompanyName: (name: string) => void;
  setHumanizeLevel: (n: number) => void;
  setBulletDecision: (key: string, decision: BulletDecision) => void;
  setAllBulletDecisions: (changes: BulletChange[], decision: BulletDecision) => void;
  runAnalysis: (resumeId: string) => Promise<void>;
  runTailoring: (resumeId: string) => Promise<void>;
  applyDecisions: (resumeId: string) => Promise<void>;
  discardPending: () => void;
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
  suggestedSkills: [],
  humanizeLevel: 50,
  isLoading: false,
  isAnalyzing: false,
  isApplying: false,
  error: null,
  pendingContent: null,
  bulletDecisions: {},

  setJd: (id, text) => set({ jdId: id, jdText: text }),
  setCompanyName: (name) => set({ companyName: name }),
  setHumanizeLevel: (n) => set({ humanizeLevel: n }),
  setBulletDecision: (key, decision) =>
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, [key]: decision } })),
  setAllBulletDecisions: (changes, decision) => {
    const decisions: Record<string, BulletDecision> = {};
    for (const c of changes) decisions[c.key] = decision;
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, ...decisions } }));
  },

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
      suggestedSkills: [],
      sessionId: null,
      pendingContent: null,
      bulletDecisions: {},
    });
    try {
      const result = await apiClient.tailorResume(
        resumeId,
        jdId,
        humanizeLevel,
        companyName || undefined,
      );

      // Build initial bullet decisions — all changed bullets default to 'accept'.
      // We compare against the current resume content to find what changed.
      const initialDecisions: Record<string, BulletDecision> = {};
      if (result.tailored_content) {
        const originalContent = useResumeStore.getState().content;
        if (originalContent) {
          result.tailored_content.experience.forEach((job, jobIdx) => {
            const origJob = originalContent.experience[jobIdx];
            job.bullets.forEach((bullet, bulletIdx) => {
              const origBullet = origJob?.bullets[bulletIdx] ?? "";
              if (bullet !== origBullet) {
                initialDecisions[`exp${jobIdx}_b${bulletIdx}`] = "accept";
              }
            });
          });
          // Per-skill decisions: added skills default to "accept", removed skills default to "reject"
          const originalSkillsSet = new Set(originalContent.skills);
          const tailoredSkillsSet = new Set(result.tailored_content.skills);
          for (const s of result.tailored_content.skills) {
            if (!originalSkillsSet.has(s)) initialDecisions[`skill_add:${s}`] = "accept";
          }
          for (const s of originalContent.skills) {
            if (!tailoredSkillsSet.has(s)) initialDecisions[`skill_rm:${s}`] = "reject";
          }
        }
      }

      set({
        sessionId: result.session_id,
        atsScore: result.ats_score,
        matchedSkills: result.matched_skills,
        missingSkills: result.missing_skills,
        companyKeywords: result.company_keywords ?? [],
        suggestedSkills: result.suggested_skills ?? [],
        pendingContent: result.tailored_content ?? null,
        bulletDecisions: initialDecisions,
        isLoading: false,
      });
    } catch (e: unknown) {
      set({
        error: e instanceof Error ? e.message : "Tailoring failed",
        isLoading: false,
      });
    }
  },

  // Apply accepted bullet decisions to the resume store, save, and regenerate PDF.
  applyDecisions: async (resumeId: string) => {
    const { pendingContent, bulletDecisions, suggestedSkills } = get();
    const resumeStore = useResumeStore.getState();
    const originalContent = resumeStore.content;
    if (!pendingContent || !originalContent) return;

    // Merge: use tailored bullet unless user rejected it.
    const mergedExperience = pendingContent.experience.map((job, jobIdx) => {
      const origJob = originalContent.experience[jobIdx];
      const mergedBullets = job.bullets.map((bullet, bulletIdx) => {
        const key = `exp${jobIdx}_b${bulletIdx}`;
        const origBullet = origJob?.bullets[bulletIdx] ?? "";
        const decision = bulletDecisions[key] ?? "accept";
        return decision === "reject" ? origBullet : bullet;
      });
      return { ...job, bullets: mergedBullets };
    });

    // Skills: start with original, add only user-selected suggested skills
    const originalSkillsSet = new Set(originalContent.skills);
    const userSelectedSkills = suggestedSkills.filter(
      (s) => bulletDecisions[`skill_add:${s}`] === "accept",
    );
    const mergedSkills = [
      ...originalContent.skills,
      ...userSelectedSkills.filter((s) => !originalSkillsSet.has(s)),
    ];

    const mergedContent = {
      ...pendingContent,
      experience: mergedExperience,
      skills: mergedSkills,
    };

    set({ isApplying: true, error: null });
    try {
      resumeStore.updateContent(mergedContent);
      await resumeStore.saveNow();
      const { signed_url } = await apiClient.generatePdf(
        resumeId,
        useResumeStore.getState().templateId,
      );
      useResumeStore.getState().setPdfSignedUrl(signed_url);
      // Clear pending state after successful apply
      set({ pendingContent: null, bulletDecisions: {}, isApplying: false });
    } catch (err) {
      console.error("Apply decisions failed:", err);
      set({ error: "Failed to apply changes", isApplying: false });
    }
  },

  discardPending: () => set({ pendingContent: null, bulletDecisions: {}, suggestedSkills: [] }),

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
      suggestedSkills: [],
      humanizeLevel: 50,
      isLoading: false,
      isAnalyzing: false,
      isApplying: false,
      error: null,
      pendingContent: null,
      bulletDecisions: {},
    }),
}));
