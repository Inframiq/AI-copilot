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

// Merge accepted bullet decisions into the original content — shared by
// generatePreview (renders a PDF from this) and reanalyzePreview (scores
// this against the JD). Never written to the resume store or backend.
function buildMergedContent(
  pendingContent: ResumeContent,
  originalContent: ResumeContent,
  bulletDecisions: Record<string, BulletDecision>,
  suggestedSkills: string[],
): ResumeContent {
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

  return {
    ...pendingContent,
    experience: mergedExperience,
    skills: mergedSkills,
  };
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
  prioritySkills: string[];  // user-picked "not matched" keywords to prioritize — set from the JD detail page before calling runTailoring
  humanizeLevel: number;
  isLoading: boolean;
  isAnalyzing: boolean;
  isApplying: boolean;
  isReanalyzing: boolean;
  error: string | null;

  // Pending review state — populated after tailoring, cleared after save/discard
  pendingContent: ResumeContent | null;
  bulletDecisions: Record<string, BulletDecision>;
  // The merged (accepted-bullets-applied) content behind the current preview —
  // this is what a later "Save" would persist. Never written to the resume
  // store or backend until the user explicitly saves.
  mergedContent: ResumeContent | null;
  previewPdfUrl: string | null;

  setJd: (id: string, text: string) => void;
  setCompanyName: (name: string) => void;
  setPrioritySkills: (skills: string[]) => void;
  togglePrioritySkill: (skill: string) => void;
  /** Hydrate analysis results directly — used when navigating from the JD
   * detail page (which runs its own react-query analysis) to the studio. */
  setAnalysisResults: (results: {
    atsScore: number | null;
    matchedSkills: string[];
    missingSkills: string[];
    companyKeywords: string[];
  }) => void;
  setHumanizeLevel: (n: number) => void;
  setBulletDecision: (key: string, decision: BulletDecision) => void;
  setAllBulletDecisions: (changes: BulletChange[], decision: BulletDecision) => void;
  updatePendingBullet: (jobIdx: number, bulletIdx: number, text: string) => void;
  runAnalysis: (resumeId: string) => Promise<void>;
  runTailoring: (resumeId: string) => Promise<void>;
  /** Renders a PDF preview of the accepted changes. Does NOT touch the
   * resume store or persist anything — the original resume is untouched
   * until saveTailoredResume is explicitly called. */
  generatePreview: (resumeId: string) => Promise<void>;
  /** Re-scores the resume exactly as currently shown in review (accepted/
   * rejected/humanized bullets, still unsaved) against the JD. Updates
   * atsScore/matchedSkills/missingSkills/companyKeywords in place; persists
   * nothing. */
  reanalyzePreview: (resumeId: string) => Promise<void>;
  /** Persists the previewed content — either overwriting the original resume
   * ("update") or creating a brand-new resume record ("new"), the user's
   * explicit choice. Returns the id of the resume the content now lives in. */
  saveTailoredResume: (
    resumeId: string,
    mode: "update" | "new",
    newTitle?: string
  ) => Promise<string>;
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
  prioritySkills: [],
  humanizeLevel: 50,
  isLoading: false,
  isAnalyzing: false,
  isApplying: false,
  isReanalyzing: false,
  error: null,
  pendingContent: null,
  bulletDecisions: {},
  mergedContent: null,
  previewPdfUrl: null,

  // Changing the JD invalidates any priority-skill picks made for the
  // previous one — EditorPanel's own JD-context textarea calls this too,
  // and unlike the two JD pages, it never explicitly sets prioritySkills
  // itself, so this is the one place that must clear it for everyone.
  setJd: (id, text) => set({ jdId: id, jdText: text, prioritySkills: [] }),
  setCompanyName: (name) => set({ companyName: name }),
  setPrioritySkills: (skills) => set({ prioritySkills: skills }),
  togglePrioritySkill: (skill) =>
    set((s) => ({
      prioritySkills: s.prioritySkills.includes(skill)
        ? s.prioritySkills.filter((s2) => s2 !== skill)
        : [...s.prioritySkills, skill],
    })),
  setHumanizeLevel: (n) => set({ humanizeLevel: n }),
  setAnalysisResults: ({ atsScore, matchedSkills, missingSkills, companyKeywords }) =>
    set({ atsScore, matchedSkills, missingSkills, companyKeywords }),
  setBulletDecision: (key, decision) =>
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, [key]: decision } })),
  setAllBulletDecisions: (changes, decision) => {
    const decisions: Record<string, BulletDecision> = {};
    for (const c of changes) decisions[c.key] = decision;
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, ...decisions } }));
  },

  updatePendingBullet: (jobIdx, bulletIdx, text) => {
    const { pendingContent } = get();
    if (!pendingContent) return;
    const newExp = pendingContent.experience.map((job, ji) => {
      if (ji !== jobIdx) return job;
      const newBullets = job.bullets.map((b, bi) => (bi === bulletIdx ? text : b));
      return { ...job, bullets: newBullets };
    });
    set({ pendingContent: { ...pendingContent, experience: newExp } });
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
    const { jdText, humanizeLevel, companyName, prioritySkills } = get();

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
      mergedContent: null,
      previewPdfUrl: null,
    });

    let started: { session_id: string; status: string };
    try {
      started = await apiClient.tailorResume(
        resumeId,
        jdId,
        humanizeLevel,
        companyName || undefined,
        prioritySkills,
      );
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : "Tailoring failed", isLoading: false });
      return;
    }

    // Poll GET /ai/sessions/{id} — the background job on the server can take
    // 30-90s+ (chained LLM calls), well past what a single HTTP request can
    // wait on Render's proxy. See routers/ai.py's _run_tailoring_background
    // for why this exists. The "Tailor Resume" button is disabled while
    // isLoading is true, so this can't overlap with a second call.
    const POLL_INTERVAL_MS = 3000;
    const MAX_ATTEMPTS = 40; // ~2 minutes ceiling

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let session;
      try {
        session = await apiClient.getSession(started.session_id);
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : "Tailoring failed", isLoading: false });
        return;
      }

      if (session.status === "completed") {
        const initialDecisions: Record<string, BulletDecision> = {};
        if (session.tailored_content) {
          const originalContent = useResumeStore.getState().content;
          if (originalContent) {
            session.tailored_content.experience.forEach((job, jobIdx) => {
              const origJob = originalContent.experience[jobIdx];
              job.bullets.forEach((bullet, bulletIdx) => {
                const origBullet = origJob?.bullets[bulletIdx] ?? "";
                if (bullet !== origBullet) {
                  initialDecisions[`exp${jobIdx}_b${bulletIdx}`] = "accept";
                }
              });
            });
            const originalSkillsSet = new Set(originalContent.skills);
            const tailoredSkillsSet = new Set(session.tailored_content.skills);
            for (const s of session.tailored_content.skills) {
              if (!originalSkillsSet.has(s)) initialDecisions[`skill_add:${s}`] = "accept";
            }
            for (const s of originalContent.skills) {
              if (!tailoredSkillsSet.has(s)) initialDecisions[`skill_rm:${s}`] = "reject";
            }
          }
        }

        const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
        for (const s of session.suggested_skills) {
          if (prioritySet.has(s.toLowerCase())) {
            initialDecisions[`skill_add:${s}`] = "accept";
          }
        }

        set({
          sessionId: session.session_id,
          atsScore: session.ats_score,
          matchedSkills: session.matched_skills,
          missingSkills: session.missing_skills,
          companyKeywords: session.company_keywords,
          suggestedSkills: session.suggested_skills,
          pendingContent: session.tailored_content,
          bulletDecisions: initialDecisions,
          isLoading: false,
        });
        return;
      }

      if (session.status === "failed") {
        set({ error: "Tailoring failed — please try again.", isLoading: false });
        return;
      }

      // Still pending — wait before the next check, unless this was the last attempt.
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }

    set({
      error: "Tailoring is taking longer than expected. Please try again in a moment.",
      isLoading: false,
    });
  },

  // Merge accepted bullet decisions into the original content and render a
  // preview PDF from that merged content. This never writes to the resume
  // store or the backend — the original resume stays exactly as it was
  // until the user explicitly calls saveTailoredResume.
  generatePreview: async (resumeId: string) => {
    const { pendingContent, bulletDecisions, suggestedSkills } = get();
    const originalContent = useResumeStore.getState().content;
    if (!pendingContent || !originalContent) return;

    const mergedContent = buildMergedContent(pendingContent, originalContent, bulletDecisions, suggestedSkills);

    set({ isApplying: true, error: null, mergedContent });
    try {
      const { signed_url } = await apiClient.generatePdf(
        resumeId,
        useResumeStore.getState().templateId,
        mergedContent,
      );
      set({ previewPdfUrl: signed_url, isApplying: false });
      // Also drive the Studio page's dedicated PDF Preview panel — it reads
      // its own pdfSignedUrl from the resume store, so without this the
      // "Preview Tailored Resume" render would only ever show up inline
      // under the bullet list, never in the preview pane it's supposed to
      // occupy. This does NOT persist anything (setPdfSignedUrl is just
      // display state); saveTailoredResume is still the only write path.
      useResumeStore.getState().setPdfSignedUrl(signed_url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate preview";
      set({ error: msg, isApplying: false });
      throw new Error(msg);
    }
  },

  // Re-score the same merged (accepted/rejected/humanized) content against
  // the JD — surfaced after per-bullet Humanize, since humanizing can lower
  // keyword density and the ATS Score shown otherwise never reflects that
  // until this is called. Never persists anything.
  reanalyzePreview: async (resumeId: string) => {
    const { pendingContent, bulletDecisions, suggestedSkills, jdId, companyName } = get();
    const originalContent = useResumeStore.getState().content;
    if (!pendingContent || !originalContent || !jdId) return;

    const mergedContent = buildMergedContent(pendingContent, originalContent, bulletDecisions, suggestedSkills);

    set({ isReanalyzing: true, error: null });
    try {
      const result = await apiClient.analyzeJd(resumeId, jdId, companyName, mergedContent);
      set({
        atsScore: result.ats_score,
        matchedSkills: result.matched_skills,
        missingSkills: result.missing_skills,
        companyKeywords: result.company_keywords ?? [],
        isReanalyzing: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reanalyze failed";
      set({ error: msg, isReanalyzing: false });
      throw new Error(msg);
    }
  },

  // Explicit, user-initiated persistence of the previewed content. "update"
  // overwrites the original resume; "new" creates a separate resume record
  // so the original is never touched. Only ever called from a save
  // confirmation the user clicked — never automatically.
  saveTailoredResume: async (resumeId, mode, newTitle) => {
    const { mergedContent } = get();
    const resumeStore = useResumeStore.getState();
    if (!mergedContent) throw new Error("No previewed content to save");

    set({ isApplying: true, error: null });
    try {
      let targetId = resumeId;
      if (mode === "update") {
        await apiClient.updateResume(resumeId, {
          content: mergedContent,
          template_id: resumeStore.templateId,
        });
        resumeStore.setResume(resumeId, mergedContent, resumeStore.templateId);
      } else {
        const created = await apiClient.createResume({
          title: newTitle?.trim() || "Tailored Resume",
          template_id: resumeStore.templateId,
          content: mergedContent,
        });
        targetId = created.id;
      }
      const { signed_url } = await apiClient.generatePdf(targetId, resumeStore.templateId);
      if (mode === "update") useResumeStore.getState().setPdfSignedUrl(signed_url);
      set({
        pendingContent: null,
        bulletDecisions: {},
        mergedContent: null,
        previewPdfUrl: null,
        isApplying: false,
      });
      return targetId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save resume";
      set({ error: msg, isApplying: false });
      throw new Error(msg);
    }
  },

  discardPending: () =>
    set({
      pendingContent: null,
      bulletDecisions: {},
      suggestedSkills: [],
      mergedContent: null,
      previewPdfUrl: null,
    }),

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
      prioritySkills: [],
      humanizeLevel: 50,
      isLoading: false,
      isAnalyzing: false,
      isApplying: false,
      error: null,
      pendingContent: null,
      bulletDecisions: {},
      mergedContent: null,
      previewPdfUrl: null,
    }),
}));
