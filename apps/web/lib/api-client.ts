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
        "title" | "template_id" | "content" | "line_spacing" | "paragraph_spacing" | "font_choice" | "accent_color"
      >
    >
  ): Promise<Resume> => request<Resume>("PATCH", `/resumes/${id}`, payload),

  deleteResume: (id: string): Promise<void> =>
    request<void>("DELETE", `/resumes/${id}`),

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
    accentColor?: string | null
  ): Promise<{ signed_url: string }> =>
    request<{ signed_url: string }>("POST", `/resumes/${id}/pdf`, {
      template_id: templateId,
      ...(contentOverride ? { content: contentOverride } : {}),
      ...(lineSpacing !== undefined ? { line_spacing: lineSpacing } : {}),
      ...(paragraphSpacing !== undefined ? { paragraph_spacing: paragraphSpacing } : {}),
      ...(fontChoice !== undefined ? { font_choice: fontChoice } : {}),
      ...(accentColor !== undefined ? { accent_color: accentColor } : {}),
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
    prioritySkills?: string[],
  ): Promise<{ session_id: string; status: string }> =>
    request("POST", "/ai/tailor", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
      ...(companyName?.trim() ? { company_name: companyName.trim() } : {}),
      ...(prioritySkills && prioritySkills.length > 0 ? { priority_skills: prioritySkills } : {}),
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
  }): Promise<{ rewritten_text: string }> =>
    request<{ rewritten_text: string }>("POST", "/ai/rewrite-bullet", payload),

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
  }> => request("GET", `/ai/sessions/${sessionId}`),

  // Pure re-score of a completed session's résumé with a chosen subset of its
  // ats_fixes applied — powers the review screen's running "Projected ATS"
  // number. No LLM call server-side.
  projectScore: (
    sessionId: string,
    acceptedFixIds: string[]
  ): Promise<{ projected_score: number }> =>
    request<{ projected_score: number }>("POST", "/ai/project-score", {
      session_id: sessionId,
      accepted_fix_ids: acceptedFixIds,
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

  getPlans: (): Promise<{ plans: Plan[] }> =>
    request<{ plans: Plan[] }>("GET", "/plans"),
};
