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
  experience: Array<{
    company: string;
    title: string;
    start: string;
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
}

export interface Resume {
  id: string;
  user_id: string;
  title: string;
  template_id: string;
  content: ResumeContent;
  ats_score?: number;
  pdf_path?: string;
  created_at: string;
  updated_at: string;
}

export interface JobDescription {
  id: string;
  user_id: string;
  title: string;
  raw_text: string;
  parsed_skills: string[];
  created_at: string;
}

export interface TailorOut {
  session_id: string;
  resume_id: string;
  jd_id: string;
  ats_score_before: number;
  ats_score_after: number;
  matched_skills: string[];
  missing_skills: string[];
  tailored_content: ResumeContent;
  humanize_level: number;
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

export interface LearningItem {
  id: string;
  skill: string;
  source_jd_title: string | null;
  status: "not_started" | "learning" | "done";
  created_at: string;
}
