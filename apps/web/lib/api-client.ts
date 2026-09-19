import { createBrowserClient } from "@/lib/supabase";
import type {
  Resume,
  JobDescription,
  JDStatus,
  AnalyzeOut,
  PrepQuestionOut,
  PrepQuestionWithJdOut,
  ResumeContent,
  LearningItem,
  ExternalContact,
  JDDetails,
  CoverLetter,
  CoverLetterStart,
  JDCoverLetter,
  AtsFix,
  Subscription,
  Plan,
  Feedback,
  FeedbackAdmin,
  AdminUser,
} from "@career-copilot/types";

export type { AtsFix } from "@career-copilot/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
if (!BASE && typeof window !== "undefined") {
  console.error("NEXT_PUBLIC_API_URL is not set — all API calls will fail");
}

async function getToken(): Promise<string> {
  const supabase = createBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

/** Carries the HTTP status alongside the message, so callers can distinguish
 * "not found" from other failures (network error, auth, server error)
 * instead of just knowing *something* went wrong. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, err.detail ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Why one bullet was transformed: the JD responsibility the rewrite is meant
 * to demonstrate, and the JD keywords woven in to do it. */
export interface PolicyAcceptance {
  terms_version: string | null;
  privacy_version: string | null;
  accepted_at: string | null;
}

export interface BulletRationale {
  responsibility: string;
  keywords: string[];
  /** Points this rewrite adds on its own. Absent on older sessions. */
  score_delta?: number;
}

/** One rewrite the server's fact-lock flagged, with the reason(s) — e.g. a
 * number the original lacks. The rewrite is kept; the review starts it
 * unticked and shows the reasons. (Named for the old behaviour, when these
 * were reverted; sessions from then carry the original text instead.) */
export interface RevertedBullet {
  bullet_id: string;
  reasons: string[];
  original_text: string;
  rejected_text: string;
}

export const apiClient = {
  // ── Resumes ──────────────────────────────────────────────────────────────
  getResumes: (): Promise<Resume[]> => request<Resume[]>("GET", "/resumes"),

  getResume: (id: string): Promise<Resume> =>
    request<Resume>("GET", `/resumes/${id}`),

  getOriginalResumeFile: (
    id: string
  ): Promise<{ signed_url: string; file_name: string | null }> =>
    request<{ signed_url: string; file_name: string | null }>(
      "GET",
      `/resumes/${id}/original`
    ),

  /** Signed URL for the most recently generated PDF, if one exists — a
   * cheap storage lookup, not a re-render. Throws an ApiError with
   * status 404 when this resume has never had a PDF generated. */
  getLatestResumePdf: (
    id: string
  ): Promise<{ signed_url: string; file_name: string | null }> =>
    request<{ signed_url: string; file_name: string | null }>(
      "GET",
      `/resumes/${id}/pdf`
    ),

  createResume: (payload: {
    title: string;
    template_id?: string;
    content?: ResumeContent;
    line_spacing?: number;
    paragraph_spacing?: number;
    font_choice?: string;
    accent_color?: string | null;
    heading_size_delta?: number;
    body_size_delta?: number;
    /** When set, saves this as "the tailored resume for this JD" — the
     * backend overwrites the JD's already-linked resume (if any) instead of
     * creating a new row, so re-tailoring + saving again doesn't pile up
     * duplicates. */
    jd_id?: string;
  }): Promise<Resume> => request<Resume>("POST", "/resumes", payload),

  updateResume: (
    id: string,
    payload: Partial<
      Pick<
        Resume,
        | "title" | "template_id" | "content" | "line_spacing" | "paragraph_spacing"
        | "font_choice" | "accent_color" | "heading_size_delta" | "body_size_delta"
      >
    >
  ): Promise<Resume> => request<Resume>("PATCH", `/resumes/${id}`, payload),

  deleteResume: (id: string): Promise<void> =>
    request<void>("DELETE", `/resumes/${id}`),

  /** The rendered document the Studio edits in place.
   *
   * Same template path as generatePdf — the server returns the exact HTML it
   * would hand to WeasyPrint — so what the user edits is what exports. Pure
   * render: it persists and uploads nothing.
   *
   * photo_placeholder: the résumé carries a photo the server could not fetch,
   * so a grey silhouette stands in. The document still renders — the Studio
   * says so rather than let a stand-in reach an export unnoticed. */
  renderResumeHtml: (
    resumeId: string,
    opts?: {
      content?: ResumeContent;
      template_id?: string;
      line_spacing?: number;
      paragraph_spacing?: number;
      font_choice?: string;
      accent_color?: string | null;
      heading_size_delta?: number;
      body_size_delta?: number;
    },
  ): Promise<{ html: string; photo_placeholder?: boolean }> =>
    request<{ html: string; photo_placeholder?: boolean }>(
      "POST",
      `/resumes/${resumeId}/html`,
      opts ?? {},
    ),

  generatePdf: (
    id: string,
    templateId: string,
    /** Renders this content instead of the resume's saved content, without
     * persisting it — used for previewing unsaved AI tailoring results. */
    contentOverride?: ResumeContent,
    /** Omitted (undefined) means "use the resume's saved value" — passing
     * either persists it onto the resume, same as templateId, unless
     * contentOverride is also set (an unsaved preview never persists). */
    lineSpacing?: number,
    paragraphSpacing?: number,
    fontChoice?: string,
    accentColor?: string | null,
    headingSizeDelta?: number,
    bodySizeDelta?: number,
    // page_count / page_fill / underfilled: "resume is shorter than a page"
    // advisory. underfilled is true only for a single-page resume that leaves
    // a visible empty band at the bottom.
  ): Promise<{ signed_url: string; page_count?: number; page_fill?: number; underfilled?: boolean }> =>
    request<{ signed_url: string; page_count?: number; page_fill?: number; underfilled?: boolean }>("POST", `/resumes/${id}/pdf`, {
      template_id: templateId,
      ...(contentOverride ? { content: contentOverride } : {}),
      ...(lineSpacing !== undefined ? { line_spacing: lineSpacing } : {}),
      ...(paragraphSpacing !== undefined ? { paragraph_spacing: paragraphSpacing } : {}),
      ...(fontChoice !== undefined ? { font_choice: fontChoice } : {}),
      ...(accentColor !== undefined ? { accent_color: accentColor } : {}),
      ...(headingSizeDelta !== undefined ? { heading_size_delta: headingSizeDelta } : {}),
      ...(bodySizeDelta !== undefined ? { body_size_delta: bodySizeDelta } : {}),
    }),

  parseResumeFile: async (
    file: File,
    templateId: string,
    /** When set, overwrites this existing resume in place instead of
     * creating a new, orphaned one — used by the Profile page's "Replace"
     * flow so re-uploading doesn't leave the old resume dangling around. */
    resumeId?: string
  ): Promise<Resume> => {
    const token = await getToken();
    const form = new FormData();
    form.append("file", file);
    form.append("template_id", templateId);
    if (resumeId) form.append("resume_id", resumeId);
    const res = await fetch(`${BASE}/resumes/parse-upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Upload failed");
    }
    return res.json() as Promise<Resume>;
  },

  // ── Job Descriptions ──────────────────────────────────────────────────────
  getJds: (): Promise<JobDescription[]> =>
    request<JobDescription[]>("GET", "/jd"),

  getJd: (id: string): Promise<JobDescription> =>
    request<JobDescription>("GET", `/jd/${id}`),

  createJd: (payload: {
    title: string;
    raw_text: string;
  }): Promise<JobDescription> =>
    request<JobDescription>("POST", "/jd", payload),

  updateJdStatus: (id: string, status: JDStatus): Promise<JobDescription> =>
    request<JobDescription>("PATCH", `/jd/${id}/status`, { status }),

  updateJdTitle: (id: string, title: string): Promise<JobDescription> =>
    request<JobDescription>("PATCH", `/jd/${id}/title`, { title }),

  getLatestJdSession: (id: string): Promise<{ session_id: string | null }> =>
    request<{ session_id: string | null }>("GET", `/jd/${id}/latest-session`),

  getJdDetails: (id: string): Promise<JDDetails> =>
    request<JDDetails>("GET", `/jd/${id}/details`),

  deleteJd: (id: string): Promise<void> =>
    request<void>("DELETE", `/jd/${id}`),

  // ── Cover Letters ────────────────────────────────────────────────────────
  generateCoverLetter: (
    resumeId: string,
    jdId: string,
    humanizeLevel: number,
    tailoringSessionId?: string,
    companyName?: string
  ): Promise<CoverLetterStart> =>
    request<CoverLetterStart>("POST", "/cover-letters", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
      tailoring_session_id: tailoringSessionId,
      company_name: companyName,
    }),

  getCoverLetter: (id: string): Promise<CoverLetter> =>
    request<CoverLetter>("GET", `/cover-letters/${id}`),

  getCoverLetters: (): Promise<CoverLetter[]> =>
    request<CoverLetter[]>("GET", "/cover-letters"),

  getJdCoverLetter: (jdId: string): Promise<JDCoverLetter> =>
    request<JDCoverLetter>("GET", `/jd/${jdId}/cover-letter`),

  updateCoverLetter: (id: string, content: string): Promise<CoverLetter> =>
    request<CoverLetter>("PATCH", `/cover-letters/${id}`, { content }),

  generateCoverLetterPdf: (id: string): Promise<{ signed_url: string }> =>
    request<{ signed_url: string }>("POST", `/cover-letters/${id}/pdf`),

  deleteCoverLetter: (id: string): Promise<void> =>
    request<void>("DELETE", `/cover-letters/${id}`),

  // ── External Contacts ───────────────────────────────────────────────────────
  getContacts: (): Promise<ExternalContact[]> =>
    request<ExternalContact[]>("GET", "/contacts"),

  addContact: (payload: {
    name: string;
    role: string;
    company: string;
    status?: ExternalContact["status"];
    notes?: string;
    email?: string;
    linkedin_url?: string;
  }): Promise<ExternalContact> => request<ExternalContact>("POST", "/contacts", payload),

  updateContactStatus: (
    id: string,
    status: ExternalContact["status"]
  ): Promise<ExternalContact> =>
    request<ExternalContact>("PATCH", `/contacts/${id}/status`, { status }),

  deleteContact: (id: string): Promise<void> =>
    request<void>("DELETE", `/contacts/${id}`),

  // ── AI ────────────────────────────────────────────────────────────────────
  analyzeJd: (
    resumeId: string,
    jdId: string,
    companyName?: string,
    /** Unsaved content to score instead of what's persisted on resumeId —
     * the bullet-review screen's Reanalyze action uses this to re-score the
     * currently accepted/rejected/humanized bullets without saving them. */
    contentOverride?: ResumeContent,
  ): Promise<AnalyzeOut> =>
    request<AnalyzeOut>("POST", "/ai/analyze", {
      resume_id: resumeId,
      jd_id: jdId,
      ...(companyName?.trim() ? { company_name: companyName.trim() } : {}),
      ...(contentOverride ? { content: contentOverride } : {}),
    }),

  tailorResume: (
    resumeId: string,
    jdId: string,
    humanizeLevel: number,
    companyName?: string,
    /** Skip reusing an identical earlier run — "Try another version". */
    fresh = false,
  ): Promise<{ session_id: string; status: string; reused?: boolean }> =>
    request("POST", "/ai/tailor", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
      ...(companyName?.trim() ? { company_name: companyName.trim() } : {}),
      ...(fresh ? { fresh: true } : {}),
    }),

  rewriteBullet: (payload: {
    bullet_text: string;
    mode: "rewrite" | "humanize" | "custom";
    jd_context?: string;
    humanize_level?: number;
    /** Required when mode is "custom" — free-text instructions for how to rewrite the text. */
    custom_instruction?: string;
    /** Changes prompt framing: single-line bullet vs. an 80-word-cap paragraph. Defaults to "bullet". */
    field?: "bullet" | "summary";
    /** Non-empty when the server's fact-lock rejected the model's rewrite, in
     * which case rewritten_text is the ORIGINAL, unchanged. */
  }): Promise<{ rewritten_text: string; reverted_reasons?: string[] }> =>
    request<{ rewritten_text: string; reverted_reasons?: string[] }>(
      "POST", "/ai/rewrite-bullet", payload,
    ),

  getSession: (sessionId: string): Promise<{
    session_id: string;
    // Null once the input resume this was tailored against has since been
    // deleted — tailored_content below is a self-contained snapshot and
    // doesn't depend on it.
    resume_id: string | null;
    jd_id: string;
    status: "pending" | "completed" | "failed";
    tailored_content: ResumeContent | null;
    ats_score: number | null;
    matched_skills: string[];
    missing_skills: string[];
    company_keywords: string[];
    suggested_skills: string[];
    /** Accept/reject "gap → fix" list from the tailor pipeline. `[]` on
     * sessions tailored before this feature shipped. */
    ats_fixes?: AtsFix[];
    /** {original_bullet_id: "high"|"medium"|"low"} for the résumé's existing
     * bullets. `{}` on pre-feature sessions. */
    bullet_importance?: Record<string, "high" | "medium" | "low">;
    /** Rewrites the server's deterministic fact-lock flagged for the
     * candidate to confirm. `[]` on sessions tailored before the guard
     * shipped. See apps/api/app/services/bullet_guard.py. */
    reverted_bullets?: RevertedBullet[];
    /** {bullet_id: rationale} — Agent 2's account of why each bullet was
     * transformed. `{}` on sessions tailored before it was persisted. */
    bullet_rationale?: Record<string, BulletRationale>;
    /** {bullet_id: question} asking the user for a number each still
     * unquantified bullet could carry. `{}` on older sessions. */
    quantify_prompts?: Record<string, string>;
    /** The score before tailoring ran; `ats_score` is the after. Null on
     * sessions tailored before it was recorded. */
    ats_score_before?: number | null;
  }> => request("GET", `/ai/sessions/${sessionId}`),

  // Pure re-score of a completed session's résumé with a chosen subset of its
  // ats_fixes applied — powers the review screen's running "Projected ATS"
  // number. No LLM call server-side.
  projectScore: (
    sessionId: string,
    acceptedFixIds: string[],
    // The résumé exactly as the review screen currently shows it. When given,
    // the server scores this instead of the session's stored (all-accepted)
    // tailored_content, so rejected bullet rewrites actually move the number.
    content?: ResumeContent,
    // Review keys ("exp0_b2") of the rewrites being kept. The server credits
    // each with what it covered, so every tick moves the projected score.
    acceptedBulletIds?: string[],
    // The candidate's own text per rewritten bullet. The session stores only
    // the tailored side, so without this the server cannot score a rewrite
    // turned off, and its badge stays frozen at the pipeline value.
    originalBullets?: Record<string, string>,
  ): Promise<{
    projected_score: number;
    fix_deltas?: Record<string, number>;
    bullet_deltas?: Record<string, number>;
  }> =>
    request<{ projected_score: number }>("POST", "/ai/project-score", {
      session_id: sessionId,
      accepted_fix_ids: acceptedFixIds,
      ...(content ? { content } : {}),
      ...(acceptedBulletIds ? { accepted_bullet_ids: acceptedBulletIds } : {}),
      ...(originalBullets ? { original_bullets: originalBullets } : {}),
    }),

  // Most recent completed session across every JD — resolves Interview
  // Center to real, JD-specific questions on load even when the in-memory
  // tailoring store's sessionId is empty (page reload, direct nav, JD
  // switch), instead of it silently falling back to the unrelated
  // cross-user question bank.
  getLatestSession: (): Promise<{
    session_id: string | null;
    resume_id?: string | null;
    jd_id?: string;
    status?: "pending" | "completed" | "failed";
    tailored_content?: ResumeContent | null;
    ats_score?: number | null;
    matched_skills?: string[];
    missing_skills?: string[];
    company_keywords?: string[];
    suggested_skills?: string[];
  }> => request("GET", "/ai/sessions/latest"),

  getQuestions: (sessionId: string): Promise<PrepQuestionOut[]> =>
    request<PrepQuestionOut[]>(
      "GET",
      `/ai/sessions/${sessionId}/questions`
    ),

  // Every prep question generated across all of the user's JDs — one JD's
  // worth at a time, from its latest completed session — used by Interview
  // Center to categorize questions by JD and filter down to one.
  getMyQuestions: (): Promise<PrepQuestionWithJdOut[]> =>
    request<PrepQuestionWithJdOut[]>("GET", "/ai/questions/mine"),

  markQuestionPracticed: (questionId: string): Promise<PrepQuestionOut> =>
    request<PrepQuestionOut>("PATCH", `/ai/questions/${questionId}/practice`),

  // ── Learning Path ────────────────────────────────────────────────────────
  getLearningItems: (): Promise<LearningItem[]> =>
    request<LearningItem[]>("GET", "/learning"),

  addLearningItem: (payload: {
    skill: string;
    source_jd_title?: string;
  }): Promise<LearningItem> => request<LearningItem>("POST", "/learning", payload),

  updateLearningItemStatus: (
    id: string,
    status: LearningItem["status"]
  ): Promise<LearningItem> =>
    request<LearningItem>("PATCH", `/learning/${id}`, { status }),

  deleteLearningItem: (id: string): Promise<void> =>
    request<void>("DELETE", `/learning/${id}`),

  // ── Account / credits ────────────────────────────────────────────────────
  getSubscription: (): Promise<Subscription> =>
    request<Subscription>("GET", "/me/subscription"),

  /** The Terms/Privacy versions this user last agreed to (nulls if never). */
  getPolicyAcceptance: (): Promise<PolicyAcceptance> =>
    request<PolicyAcceptance>("GET", "/me/policy-acceptance"),

  acceptPolicies: (terms_version: string, privacy_version: string): Promise<void> =>
    request<void>("PUT", "/me/policy-acceptance", { terms_version, privacy_version }),

  /** Permanently deletes the signed-in user's account, all their data, and
   * the Supabase auth user itself. Irreversible — the caller is responsible
   * for signing out and clearing local state afterwards. */
  deleteAccount: (): Promise<void> => request<void>("DELETE", "/me"),

  getPlans: (): Promise<{ plans: Plan[] }> =>
    request<{ plans: Plan[] }>("GET", "/plans"),

  // ── Feedback ─────────────────────────────────────────────────────────────
  submitFeedback: (payload: {
    rating: number;
    comment?: string;
    page?: string;
  }): Promise<Feedback> => request<Feedback>("POST", "/feedback", payload),

  /** Admin only — the backend returns 403 for any other account. */
  getFeedback: (): Promise<FeedbackAdmin[]> =>
    request<FeedbackAdmin[]>("GET", "/feedback"),

  // ── Admin ────────────────────────────────────────────────────────────────
  /** Admin only — the backend returns 403 for any other account. */
  getAdminUsers: (): Promise<AdminUser[]> =>
    request<AdminUser[]>("GET", "/admin/users"),

  /** Manual override for emergencies — grants the target plan's full credit
   * allotment and resets billing status. Admin only. */
  updateUserPlan: (userId: string, plan: "free" | "premium"): Promise<AdminUser> =>
    request<AdminUser>("PATCH", `/admin/users/${userId}/plan`, { plan }),

  /** Tops the user's credits back up to their plan's full allotment. Admin only. */
  refreshUserCredits: (userId: string): Promise<AdminUser> =>
    request<AdminUser>("POST", `/admin/users/${userId}/credits/refresh`),
};
