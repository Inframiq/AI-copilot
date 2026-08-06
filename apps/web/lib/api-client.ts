import { createBrowserClient } from "@/lib/supabase";
import type {
  Resume,
  JobDescription,
  TailorOut,
  PrepQuestionOut,
  ResumeContent,
} from "@career-copilot/types";

const BASE = process.env.NEXT_PUBLIC_API_URL!;

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

  // ── Job Descriptions ──────────────────────────────────────────────────────
  getJds: (): Promise<JobDescription[]> =>
    request<JobDescription[]>("GET", "/jd"),

  createJd: (payload: {
    title: string;
    raw_text: string;
  }): Promise<JobDescription> =>
    request<JobDescription>("POST", "/jd", payload),

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
};
