// Career Copilot shared types

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface Resume {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface JobDescription {
  id: string;
  user_id: string;
  title: string;
  company: string;
  description: string;
  created_at: string;
}

export interface TailoringResult {
  id: string;
  resume_id: string;
  job_description_id: string;
  ats_score: number;
  tailored_content: string;
  suggestions: string[];
  created_at: string;
}

export interface InterviewSession {
  id: string;
  user_id: string;
  job_description_id: string;
  questions: InterviewQuestion[];
  created_at: string;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  answer?: string;
  feedback?: string;
}
