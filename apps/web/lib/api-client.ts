import { createBrowserClient } from "@/lib/supabase";
import type {
  Resume,
  JobDescription,
  JDStatus,
  TailorOut,
  AnalyzeOut,
  PrepQuestionOut,
  ResumeContent,
  LearningItem,
  ExternalContact,
} from "@career-copilot/types";

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
    throw new Error(err.detail ?? "Request failed");
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

  createResume: (payload: {
    title: string;
    template_id?: string;
    content?: ResumeContent;
  }): Promise<Resume> => request<Resume>("POST", "/resumes", payload),

  updateResume: (
    id: string,
    payload: Partial<Pick<Resume, "title" | "template_id" | "content">>
  ): Promise<Resume> => request<Resume>("PATCH", `/resumes/${id}`, payload),

  deleteResume: (id: string): Promise<void> =>
    request<void>("DELETE", `/resumes/${id}`),

  generatePdf: (
    id: string,
    templateId: string,
    /** Renders this content instead of the resume's saved content, without
     * persisting it — used for previewing unsaved AI tailoring results. */
    contentOverride?: ResumeContent
  ): Promise<{ signed_url: string }> =>
    request<{ signed_url: string }>("POST", `/resumes/${id}/pdf`, {
      template_id: templateId,
      ...(contentOverride ? { content: contentOverride } : {}),
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

  deleteJd: (id: string): Promise<void> =>
    request<void>("DELETE", `/jd/${id}`),

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
  ): Promise<TailorOut> =>
    request<TailorOut>("POST", "/ai/tailor", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
      ...(companyName?.trim() ? { company_name: companyName.trim() } : {}),
      ...(prioritySkills && prioritySkills.length > 0 ? { priority_skills: prioritySkills } : {}),
    }),

  rewriteBullet: (payload: {
    bullet_text: string;
    mode: "rewrite" | "humanize";
    jd_context?: string;
    humanize_level?: number;
  }): Promise<{ rewritten_text: string }> =>
    request<{ rewritten_text: string }>("POST", "/ai/rewrite-bullet", payload),

  getSession: (sessionId: string): Promise<{
    session_id: string;
    resume_id: string;
    jd_id: string;
    tailored_content: ResumeContent | null;
    ats_score: number | null;
    matched_skills: string[];
    missing_skills: string[];
  }> => request("GET", `/ai/sessions/${sessionId}`),

  getQuestions: (sessionId: string): Promise<PrepQuestionOut[]> =>
    request<PrepQuestionOut[]>(
      "GET",
      `/ai/sessions/${sessionId}/questions`
    ),

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
};
