import { create } from "zustand";
import { apiClient, type AtsFix } from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";
import { useResumeStore } from "@/stores/resume-store";
import type { ResumeContent } from "@career-copilot/types";
import type { ImportanceLevel } from "@/components/resume/ImportanceBadge";

// Bullet-per-role ceiling — mirrors HARD_LIMITS["experience_bullets_per_role"]
// ["max"] on the backend (resume_spec.py). A gap-filler bullet fix past this
// for its role is dropped rather than pushing the role over the limit.
const MAX_BULLETS_PER_ROLE = 7;

// Debounce for the running "Projected ATS" re-score — every accept/reject on a
// fix would otherwise fire a /ai/project-score call per click.
let _projectScoreTimer: ReturnType<typeof setTimeout> | null = null;

const _bulletTokens = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2),
  );

// Mirrors the backend's bullet_already_present (ats.py): true if `text` just
// restates a bullet already in `existing` — exact after normalisation, or
// ≥ 80% word overlap. Stops an accepted gap-filler bullet from landing next
// to a near-identical one the résumé already has.
export function bulletAlreadyPresent(existing: string[], text: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(text);
  if (!target) return false;
  const newTokens = _bulletTokens(text);
  for (const b of existing) {
    if (norm(b) === target) return true;
    if (newTokens.size === 0) continue;
    const bTokens = _bulletTokens(b);
    if (bTokens.size === 0) continue;
    let inter = 0;
    for (const w of newTokens) if (bTokens.has(w)) inter++;
    const union = newTokens.size + bTokens.size - inter;
    if (union > 0 && inter / union >= 0.8) return true;
  }
  return false;
}

// 'accept' = use tailored version, 'reject' = keep original
export type BulletDecision = "accept" | "reject";

// The from-scratch generator's 36 (resume_spec.py HARD_LIMITS:
// skill_categories.max(6) x skills_per_category.max(6)) assumes skills are
// CATEGORIZED — up to 6 labeled rows ("Languages: ...", "Cloud: ...") of up
// to 6 items each, so 36 total reads as organized, not crowded. This app's
// ResumeContent.skills is always a flat list, and every PDF template renders
// it as one unbroken comma-joined line/paragraph (see e.g.
// templates/ats_clean.html's render_skills() macro) — 36 items in a single
// line is keyword-stuffing, not a curated skills section. 20 is the
// standard ATS-resume guidance for a flat skills line: enough for a
// multi-domain candidate, short of looking padded.
export const MAX_MERGED_SKILLS = 20;

// Whether an existing skill is kept by default, absent an explicit
// "skill_keep" decision. Under the cap, there's no scarcity to force a
// choice over, so every existing skill stays kept as it always has. Over
// the cap, defaulting to "keep everything" would silently pick the first
// MAX_MERGED_SKILLS for the user (via the trailing slice) — an auto-select
// in disguise. So once the resume already has more skills than fit, none
// are kept until the user explicitly picks which ones matter for this JD.
export function defaultSkillKeepDecision(originalSkillsCount: number): BulletDecision {
  return originalSkillsCount <= MAX_MERGED_SKILLS ? "accept" : "reject";
}

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
  atsFixes: AtsFix[] = [],
  fixExperienceIndex: Record<string, number> = {},
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

  // Summary: untouched by the initial tailoring pass (pendingContent.summary
  // starts identical to originalContent.summary) — only ever diverges once
  // the user explicitly triggers Rewrite/Humanize/a custom-instruction
  // rewrite (see BulletReviewPanel's SummaryBlock), same opt-in shape as
  // per-bullet Rewrite/Humanize. "reject" reverts to the original text.
  const mergedSummary =
    (bulletDecisions["summary"] ?? "accept") === "reject"
      ? originalContent.summary
      : pendingContent.summary;

  // Skills: fully user-curated, both directions. "skill_keep" decisions
  // (see defaultSkillKeepDecision) let the user drop existing skills —
  // needed for a resume parsed/uploaded with more skills than
  // MAX_MERGED_SKILLS, where keeping literally everything would either
  // silently overflow the cap or (the previous bug) silently truncate the
  // user's own content. "skill_add" decisions (default reject) are the
  // opt-in suggested additions. The trailing slice is a backstop only —
  // the UI disables further selection once the shared budget is spent, so
  // this shouldn't normally trigger.
  const keepDefault = defaultSkillKeepDecision(originalContent.skills.length);
  const keptOriginalSkills = originalContent.skills.filter(
    (s) => (bulletDecisions[`skill_keep:${s}`] ?? keepDefault) === "accept",
  );
  const keptOriginalSet = new Set(keptOriginalSkills);
  const userSelectedSkills = suggestedSkills.filter(
    (s) => bulletDecisions[`skill_add:${s}`] === "accept" && !keptOriginalSet.has(s),
  );
  const mergedSkills = [...keptOriginalSkills, ...userSelectedSkills].slice(0, MAX_MERGED_SKILLS);

  // Fold in the accepted "gap → fix" items last, on top of the already-merged
  // pieces: a skill fix appends (under the cap, no dupes), a bullet fix
  // appends to its role (under the per-role cap), a headline fix replaces.
  const acceptedFixes = atsFixes.filter((f) => bulletDecisions[`fix:${f.id}`] === "accept");

  let headline = pendingContent.headline;
  const skillsWithFixes = [...mergedSkills];
  const expWithFixes = mergedExperience.map((e) => ({ ...e, bullets: [...e.bullets] }));

  for (const f of acceptedFixes) {
    if (f.type === "skill") {
      if (
        !skillsWithFixes.some((s) => s.toLowerCase() === f.text.toLowerCase()) &&
        skillsWithFixes.length < MAX_MERGED_SKILLS
      ) {
        skillsWithFixes.push(f.text);
      }
    } else if (f.type === "headline") {
      headline = f.text;
    } else if (f.type === "bullet") {
      // User's per-fix role pick wins; else the fix's own index; else the
      // most-recent role. A speculative bullet always lands somewhere now,
      // unless it just restates a bullet that role already has.
      const idx = fixExperienceIndex[f.id] ?? f.experience_index ?? 0;
      if (
        expWithFixes[idx] &&
        expWithFixes[idx].bullets.length < MAX_BULLETS_PER_ROLE &&
        !bulletAlreadyPresent(expWithFixes[idx].bullets, f.text)
      ) {
        expWithFixes[idx].bullets.push(f.text);
      }
    }
  }

  return {
    ...pendingContent,
    headline,
    experience: expWithFixes,
    skills: skillsWithFixes,
    summary: mergedSummary,
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
  // Per-JD term importance from POST /ai/analyze, keyed by the lowercased
  // term. Drives the High/Medium/Low marks on the matched/missing chips.
  jdImportance: Record<string, ImportanceLevel>;
  suggestedSkills: string[];  // skills Agent 2 suggests — user opts in per chip
  // Post-tailor "gap → fix" list: accept/reject entries for skills to add,
  // proposed bullets, and a headline. Empty for sessions tailored before this
  // shipped. Each fix's decision lives in bulletDecisions under `fix:${id}`.
  atsFixes: AtsFix[];
  // {original_bullet_id: "high"|"medium"|"low"} — importance mark for each
  // existing résumé bullet, shown in the bullet review list.
  bulletImportance: Record<string, ImportanceLevel>;
  // Running ATS score for the résumé with the currently-accepted fixes folded
  // in — pure server re-score (POST /ai/project-score), null until computed.
  projectedAtsScore: number | null;
  // Per-bullet-fix role override: {fixId: experienceIndex}. Set by the review
  // screen's role dropdown; buildMergedContent places the bullet there.
  fixExperienceIndex: Record<string, number>;
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
    jdImportance?: Record<string, ImportanceLevel>;
  }) => void;
  setHumanizeLevel: (n: number) => void;
  setBulletDecision: (key: string, decision: BulletDecision) => void;
  /** Accept/reject a single "gap → fix" item (stored under `fix:${id}`) and
   * kick off a debounced projected-score re-score. */
  setFixDecision: (id: string, decision: BulletDecision) => void;
  /** Pick which experience entry a bullet fix should be added under. */
  setFixExperienceIndex: (id: string, experienceIndex: number) => void;
  /** Re-run the debounced projected-score re-score for the current accepted
   * fixes — for callers that change fix decisions in bulk (e.g. Auto-select). */
  refreshProjectedScore: () => void;
  setAllBulletDecisions: (changes: BulletChange[], decision: BulletDecision) => void;
  applyBulletDecisions: (decisions: Record<string, BulletDecision>) => void;
  updatePendingBullet: (jobIdx: number, bulletIdx: number, text: string) => void;
  updatePendingSummary: (text: string) => void;
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
  jdImportance: {},
  suggestedSkills: [],
  atsFixes: [],
  bulletImportance: {},
  projectedAtsScore: null,
  fixExperienceIndex: {},
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
  setJd: (id, text) => {
    const current = get();
    // Only reset analysis results if setting a genuinely different JD
    const isDifferentJd = (id !== "" && id !== current.jdId) || text.trim() !== current.jdText.trim();
    set({
      jdId: id,
      jdText: text,
      companyName: isDifferentJd ? "" : current.companyName,
      atsScore: isDifferentJd ? null : current.atsScore,
      matchedSkills: isDifferentJd ? [] : current.matchedSkills,
      missingSkills: isDifferentJd ? [] : current.missingSkills,
      companyKeywords: isDifferentJd ? [] : current.companyKeywords,
      jdImportance: isDifferentJd ? {} : current.jdImportance,
      suggestedSkills: isDifferentJd ? [] : current.suggestedSkills,
      atsFixes: isDifferentJd ? [] : current.atsFixes,
      bulletImportance: isDifferentJd ? {} : current.bulletImportance,
      projectedAtsScore: isDifferentJd ? null : current.projectedAtsScore,
      fixExperienceIndex: isDifferentJd ? {} : current.fixExperienceIndex,
      prioritySkills: isDifferentJd ? [] : current.prioritySkills,
      pendingContent: null,
      sessionId: isDifferentJd ? null : current.sessionId,
      bulletDecisions: {},
      mergedContent: null,
      previewPdfUrl: null,
      error: null,
    });
  },
  setCompanyName: (name) => set({ companyName: name }),
  setPrioritySkills: (skills) => set({ prioritySkills: skills }),
  togglePrioritySkill: (skill) =>
    set((s) => ({
      prioritySkills: s.prioritySkills.includes(skill)
        ? s.prioritySkills.filter((s2) => s2 !== skill)
        : [...s.prioritySkills, skill],
    })),
  setHumanizeLevel: (n) => set({ humanizeLevel: n }),
  setAnalysisResults: ({ atsScore, matchedSkills, missingSkills, companyKeywords, jdImportance }) =>
    set({ atsScore, matchedSkills, missingSkills, companyKeywords, jdImportance: jdImportance ?? {} }),
  // Any edit made after a preview was already rendered invalidates that
  // preview — it was built from a snapshot of pendingContent/bulletDecisions
  // at generatePreview time, so a later Humanize/Rewrite/accept-reject/skill
  // toggle would otherwise leave the visible PDF (and, worse, whatever
  // saveTailoredResume would persist) silently out of sync with what's on
  // screen. Clearing previewPdfUrl flips the review panel back to offering
  // "Preview Tailored Resume" so the user has an obvious way to regenerate.
  setBulletDecision: (key, decision) => {
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, [key]: decision }, previewPdfUrl: null }));
    useResumeStore.getState().setPdfSignedUrl(null);
  },
  refreshProjectedScore: () => {
    const { sessionId, atsFixes, bulletDecisions } = get();
    if (!sessionId) return;
    const acceptedIds = atsFixes
      .map((f) => f.id)
      .filter((fid) => bulletDecisions[`fix:${fid}`] === "accept");
    if (_projectScoreTimer) clearTimeout(_projectScoreTimer);
    _projectScoreTimer = setTimeout(async () => {
      try {
        const { projected_score } = await apiClient.projectScore(sessionId, acceptedIds);
        set({ projectedAtsScore: projected_score });
      } catch {
        /* transient failure — keep the last projected score on screen */
      }
    }, 400);
  },
  setFixDecision: (id, decision) => {
    set((s) => ({
      bulletDecisions: { ...s.bulletDecisions, [`fix:${id}`]: decision },
      previewPdfUrl: null,
    }));
    useResumeStore.getState().setPdfSignedUrl(null);
    get().refreshProjectedScore();
  },
  setFixExperienceIndex: (id, experienceIndex) => {
    set((s) => ({
      fixExperienceIndex: { ...s.fixExperienceIndex, [id]: experienceIndex },
      previewPdfUrl: null,
    }));
    useResumeStore.getState().setPdfSignedUrl(null);
  },
  setAllBulletDecisions: (changes, decision) => {
    const decisions: Record<string, BulletDecision> = {};
    for (const c of changes) decisions[c.key] = decision;
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, ...decisions }, previewPdfUrl: null }));
    useResumeStore.getState().setPdfSignedUrl(null);
  },
  // Merges an arbitrary key→decision map in one update — for bulk actions
  // that set a MIX of accept/reject in a single click (e.g. "auto-select
  // top N skills": some skills flip to accept, others flip to reject, all
  // at once), unlike setAllBulletDecisions above which applies one uniform
  // decision to a list of keys.
  applyBulletDecisions: (decisions) => {
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, ...decisions }, previewPdfUrl: null }));
    useResumeStore.getState().setPdfSignedUrl(null);
  },

  updatePendingBullet: (jobIdx, bulletIdx, text) => {
    const { pendingContent } = get();
    if (!pendingContent) return;
    const newExp = pendingContent.experience.map((job, ji) => {
      if (ji !== jobIdx) return job;
      const newBullets = job.bullets.map((b, bi) => (bi === bulletIdx ? text : b));
      return { ...job, bullets: newBullets };
    });
    set({ pendingContent: { ...pendingContent, experience: newExp }, previewPdfUrl: null });
    useResumeStore.getState().setPdfSignedUrl(null);
  },

  updatePendingSummary: (text) => {
    const { pendingContent } = get();
    if (!pendingContent) return;
    set({ pendingContent: { ...pendingContent, summary: text }, previewPdfUrl: null });
    useResumeStore.getState().setPdfSignedUrl(null);
  },

  // Helper to ensure job description is saved to backend if not already persisted
  runAnalysis: async (resumeId: string) => {
    // Identity token for this call — unlike runTailoring's isLoading guard,
    // setJd() doesn't reset isAnalyzing, so a stale response has no flag to
    // check against. jdText changes on every keystroke once the JD Analyzer
    // textarea's content diverges from what's stored, so it's a reliable
    // "is this still the JD I was asked to analyze" check even for an
    // unsaved JD (jdId "" the whole time).
    const startedForJdText = get().jdText;
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
        if (get().jdText !== startedForJdText) return;
        jdId = jd.id;
        set({ jdId });
      } catch (e: unknown) {
        if (get().jdText !== startedForJdText) return;
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
      jdImportance: {},
      sessionId: null,
    });
    try {
      const result = await apiClient.analyzeJd(resumeId, jdId, companyName || undefined);
      if (get().jdText !== startedForJdText) return;
      set({
        atsScore: result.ats_score,
        matchedSkills: result.matched_skills,
        missingSkills: result.missing_skills,
        companyKeywords: result.company_keywords ?? [],
        jdImportance: (result.importance ?? {}) as Record<string, ImportanceLevel>,
        isAnalyzing: false,
      });
    } catch (e: unknown) {
      if (get().jdText !== startedForJdText) return;
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
      jdImportance: {},
      suggestedSkills: [],
      atsFixes: [],
      bulletImportance: {},
      projectedAtsScore: null,
      fixExperienceIndex: {},
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
    const MAX_CONSECUTIVE_FAILURES = 3; // tolerate transient blips (dropped connection, proxy 502)

    let consecutiveFailures = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Race Condition Guard: If the user reset store or started another operation, abort polling update
      if (!get().isLoading) return;

      let session;
      try {
        session = await apiClient.getSession(started.session_id);
        consecutiveFailures = 0;
      } catch (e: unknown) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          if (get().isLoading) {
            set({ error: e instanceof Error ? e.message : "Tailoring failed", isLoading: false });
          }
          return;
        }
        // Not yet at the limit — treat like a "still pending" tick and retry.
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        continue;
      }

      // Check again if state was reset during async await
      if (!get().isLoading) return;

      if (session.status === "completed") {
        const initialDecisions: Record<string, BulletDecision> = {};
        if (session.tailored_content) {
          const originalContent = useResumeStore.getState().content;
          if (originalContent && Array.isArray(originalContent.experience)) {
            session.tailored_content.experience?.forEach((job, jobIdx) => {
              const origJob = originalContent.experience[jobIdx];
              job.bullets?.forEach((bullet, bulletIdx) => {
                const origBullet = origJob?.bullets?.[bulletIdx] ?? "";
                if (bullet !== origBullet) {
                  initialDecisions[`exp${jobIdx}_b${bulletIdx}`] = "accept";
                }
              });
            });
            const originalSkillsSet = new Set(originalContent.skills || []);
            const tailoredSkillsSet = new Set(session.tailored_content.skills || []);
            for (const s of session.tailored_content.skills || []) {
              if (!originalSkillsSet.has(s)) initialDecisions[`skill_add:${s}`] = "accept";
            }
            for (const s of originalContent.skills || []) {
              if (!tailoredSkillsSet.has(s)) initialDecisions[`skill_rm:${s}`] = "reject";
            }
          }
        }

        const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
        for (const s of session.suggested_skills || []) {
          if (prioritySet.has(s.toLowerCase())) {
            initialDecisions[`skill_add:${s}`] = "accept";
          }
        }

        // Seed each gap → fix decision from the backend's default_accept
        // (only grounded bullet fixes pre-accept; everything else starts off).
        const atsFixes = (session.ats_fixes ?? []) as AtsFix[];
        for (const f of atsFixes) {
          initialDecisions[`fix:${f.id}`] = f.default_accept ? "accept" : "reject";
        }

        // A completed tailor just spent credits server-side — refresh the
        // cached balance so the credit meter updates now, not on next focus.
        queryClient.invalidateQueries({ queryKey: ["subscription"] });

        set({
          sessionId: session.session_id,
          atsScore: session.ats_score,
          matchedSkills: session.matched_skills ?? [],
          missingSkills: session.missing_skills ?? [],
          companyKeywords: session.company_keywords ?? [],
          suggestedSkills: session.suggested_skills ?? [],
          atsFixes,
          bulletImportance: (session.bullet_importance ?? {}) as Record<string, ImportanceLevel>,
          projectedAtsScore: session.ats_score ?? null,
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

    if (get().isLoading) {
      set({
        error: "Tailoring is taking longer than expected. Please try again in a moment.",
        isLoading: false,
      });
    }
  },

  // Merge accepted bullet decisions into the original content and render a
  // preview PDF from that merged content. This never writes to the resume
  // store or the backend — the original resume stays exactly as it was
  // until the user explicitly calls saveTailoredResume.
  generatePreview: async (resumeId: string) => {
    const { pendingContent, bulletDecisions, suggestedSkills, atsFixes, fixExperienceIndex } = get();
    const originalContent = useResumeStore.getState().content;
    if (!pendingContent || !originalContent) return;

    const mergedContent = buildMergedContent(pendingContent, originalContent, bulletDecisions, suggestedSkills, atsFixes, fixExperienceIndex);

    set({ isApplying: true, error: null, mergedContent });
    try {
      const resumeStoreState = useResumeStore.getState();
      const { signed_url } = await apiClient.generatePdf(
        resumeId,
        resumeStoreState.templateId,
        mergedContent,
        resumeStoreState.lineSpacing,
        resumeStoreState.paragraphSpacing,
        resumeStoreState.fontChoice,
        resumeStoreState.accentColor,
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
    const { pendingContent, bulletDecisions, suggestedSkills, atsFixes, fixExperienceIndex, jdId, companyName } = get();
    const originalContent = useResumeStore.getState().content;
    if (!pendingContent || !originalContent || !jdId) return;

    const mergedContent = buildMergedContent(pendingContent, originalContent, bulletDecisions, suggestedSkills, atsFixes, fixExperienceIndex);

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
    const { mergedContent, jdId } = get();
    const resumeStore = useResumeStore.getState();
    if (!mergedContent) throw new Error("No previewed content to save");

    set({ isApplying: true, error: null });
    try {
      let targetId = resumeId;
      if (mode === "update") {
        await apiClient.updateResume(resumeId, {
          content: mergedContent,
          template_id: resumeStore.templateId,
          font_choice: resumeStore.fontChoice,
          accent_color: resumeStore.accentColor,
        });
      } else {
        // jd_id links this save to the JD it was tailored for — the backend
        // overwrites the JD's previously-saved resume (if any) instead of
        // creating a new one, so re-tailoring + saving again doesn't pile
        // up duplicates.
        const created = await apiClient.createResume({
          title: newTitle?.trim() || "Tailored Resume",
          template_id: resumeStore.templateId,
          content: mergedContent,
          font_choice: resumeStore.fontChoice,
          accent_color: resumeStore.accentColor,
          jd_id: jdId ?? undefined,
        });
        targetId = created.id;
      }
      const { signed_url } = await apiClient.generatePdf(
        targetId,
        resumeStore.templateId,
        undefined,
        resumeStore.lineSpacing,
        resumeStore.paragraphSpacing,
        resumeStore.fontChoice,
        resumeStore.accentColor,
      );
      // Hydrate the resume store with the just-saved content/PDF regardless
      // of mode — for "new" this also points the store at the newly created
      // resume, which matters because whoever navigates to
      // /studio/{targetId} next skips re-hydrating (and so keeps this PDF)
      // only when the store's resumeId already matches.
      resumeStore.setResume(
        targetId,
        mergedContent,
        resumeStore.templateId,
        resumeStore.lineSpacing,
        resumeStore.paragraphSpacing,
        resumeStore.fontChoice,
        resumeStore.accentColor
      );
      useResumeStore.getState().setPdfSignedUrl(signed_url);
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

  discardPending: () => {
    set({
      pendingContent: null,
      bulletDecisions: {},
      suggestedSkills: [],
      atsFixes: [],
      bulletImportance: {},
      projectedAtsScore: null,
      fixExperienceIndex: {},
      mergedContent: null,
      previewPdfUrl: null,
    });
    // The PDF preview panel reads pdfSignedUrl off the resume store, not
    // previewPdfUrl above — without clearing it here too, starting a new
    // tailoring run (same resume, different JD) leaves it showing the last
    // JD's generated preview until the user regenerates one for the new JD.
    useResumeStore.getState().setPdfSignedUrl(null);
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
      jdImportance: {},
      suggestedSkills: [],
      atsFixes: [],
      bulletImportance: {},
      projectedAtsScore: null,
      fixExperienceIndex: {},
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
