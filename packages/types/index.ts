// Career Copilot shared types — canonical source of truth

export interface ResumeContent {
  contact: {
    name: string;
    email: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
    photo_url?: string;
  };
  headline?: string;
  summary?: string;
  objective?: string;
  experience: Array<{
    company: string;
    title: string;
    start: string;
    end?: string;
    bullets: string[];
  }>;
  projects?: Array<{
    name: string;
    tech_stack?: string;
    link?: string;
    start?: string;
    end?: string;
    bullets: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    year: string;
  }>;
  skills: string[];
  languages?: Array<{
    name: string;
    level: string;
  }>;
  certifications?: string[];
  awards?: string[];
  achievements?: string[];
  leadership?: string[];
  volunteer?: string[];
  /** Server-computed, content-aware section order for this resume — see
   * apps/api/app/services/resume_spec.py::resolve_section_order. Optional:
   * when absent, PDF templates fall back to their default order. */
  section_order?: string[];
}

export interface Resume {
  id: string;
  user_id: string;
  title: string;
  template_id: string;
  content: ResumeContent;
  ats_score?: number;
  pdf_path?: string;
  original_file_name?: string | null;
  created_at: string;
  updated_at: string;
}

export type JDStatus = "not_applied" | "applied" | "interview" | "final_round" | "offer" | "accepted" | "rejected";

export interface JobDescription {
  id: string;
  user_id: string;
  title: string;
  raw_text: string;
  parsed_skills: string[];
  status: JDStatus;
  created_at: string;
}

export interface ExternalContact {
  id: string;
  name: string;
  role: string;
  company: string;
  status: "new" | "following-up" | "connected";
  notes: string;
  email: string;
  linkedin_url: string;
  last_contact: string;
  created_at: string;
}

export interface TailorOut {
  session_id: string;
  ats_score: number;
  matched_skills: string[];
  missing_skills: string[];
  tailored_content: ResumeContent;
  questions: PrepQuestionOut[];
  company_keywords: string[];
  suggested_skills: string[];
}

export interface JDDetails {
  session_id: string | null;
  ats_score: number | null;
  resume_id: string | null;
  resume_title: string | null;
  resume_pdf_url: string | null;
  session_created_at: string | null;
  questions_total: number;
  questions_practiced: number;
}

export interface AnalyzeOut {
  ats_score: number;
  matched_skills: string[];
  missing_skills: string[];
  company_keywords: string[];
}

export interface PrepQuestionOut {
  id: string;
  session_id: string;
  topic: string;
  question: string;
  answer_framework: string;
  is_gap_based: boolean;
  order_index: number;
  practiced_at: string | null;
}

export interface SkillQuestionOut {
  id: string;
  skill: string;
  topic: string;
  question: string;
  answer_framework: string;
}

export interface LearningItem {
  id: string;
  skill: string;
  source_jd_title: string | null;
  status: "not_started" | "learning" | "done";
  created_at: string;
}
