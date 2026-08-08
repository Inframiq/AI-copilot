import { createBrowserClient } from "@/lib/supabase";
import type {
  Resume,
  JobDescription,
  JDStatus,
  TailorOut,
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
    templateId: string
  ): Promise<{ signed_url: string }> =>
    request<{ signed_url: string }>("POST", `/resumes/${id}/pdf`, {
      template_id: templateId,
    }),

  parseResumeFile: async (file: File, templateId: string): Promise<Resume> => {
    const token = await getToken();
    const form = new FormData();
    form.append("file", file);
    form.append("template_id", templateId);
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
  tailorResume: (
    resumeId: string,
    jdId: string,
    humanizeLevel: number
  ): Promise<TailorOut> =>
    request<TailorOut>("POST", "/ai/tailor", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
    }),

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
