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
  /** CSS line-height multiplier used when rendering this resume's PDF (1.0–1.6). */
  line_spacing: number;
  /** Space in px after each bullet list / summary / plain list (0–24). */
  paragraph_spacing: number;
  ats_score?: number;
  // Storage path (not a signed URL) — null until this resume's PDF has been
  // generated at least once. Presence, not the raw path, is what the
  // frontend needs: it decides whether to fetch the last-generated preview
  // on load via GET /resumes/{id}/pdf instead of showing an empty preview.
  pdf_url?: string | null;
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
  // Latest completed tailoring session's ATS match score for this JD, or
  // null if it's never been tailored against. See JDOut.ats_score (backend)
  // for why this lives on the JD rather than on Resume.
  ats_score: number | null;
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

export interface CoverLetter {
  id: string;
  // Null once the resume this was generated from has since been deleted —
  // the letter's own `content` survives regardless.
  resume_id: string | null;
  jd_id: string;
  tailoring_session_id: string | null;
  content: string | null;
  humanize_level: number;
  pdf_url: string | null;
  status: "pending" | "completed" | "failed";
  created_at: string;
}

export interface CoverLetterStart {
  cover_letter_id: string;
  status: string;
}

export interface JDCoverLetter {
  cover_letter_id: string | null;
  status: string | null;
  created_at: string | null;
}

export interface AnalyzeOut {
  ats_score: number;
  matched_skills: string[];
  missing_skills: string[];
  company_keywords: string[];
  /** Per-term importance for this JD, keyed by the lowercased term. Absent on
   * older responses / the reanalyze path. */
  importance?: Record<string, "high" | "medium" | "low">;
}

/** One accept/reject entry in the post-tailor "gap → fix" list: a skill to
 * add, a proposed résumé bullet, or a headline. Mirrors the backend AtsFix. */
export interface AtsFix {
  id: string;
  type: "skill" | "bullet" | "headline";
  gap: string;
  importance: "high" | "medium" | "low";
  grounded: boolean;
  text: string;
  experience_index: number | null;
  score_delta: number;
  default_accept: boolean;
}

export interface PrepQuestionOut {
  id: string;
  session_id: string;
  topic: string;
  question: string;
  answer_framework: string;
  is_gap_based: boolean;
  // "requirement" | "overlap" | "gap" — which of the three generation
  // categories this question came from (see PrepQuestion.source, backend).
  source: string;
  // Short grounding shown to the user (e.g. "Kubernetes (matched)") — see
  // PrepQuestion.basis, backend.
  basis: string;
  order_index: number;
  practiced_at: string | null;
}

// PrepQuestionOut plus which JD (by the title shown in the JD Analyzer) it
// came from — one per JD, from that JD's latest completed tailoring
// session. Powers Interview Center's per-JD grouping and filter.
export interface PrepQuestionWithJdOut extends PrepQuestionOut {
  jd_id: string;
  jd_title: string;
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
