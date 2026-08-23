"use client";
import { createBrowserClient } from "@/lib/supabase";
import type { ResumeContent } from "@career-copilot/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContactInfo {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  website?: string;
}

export type ExpType = "full-time" | "internship";

export interface ExperienceEntry {
  id: string;
  type: ExpType;
  company: string;
  title: string;
  start: string;
  end: string;
  current: boolean;
  responsibilities: string;
  achievements: string;
  projects: string;
  impact: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  techStack: string;
  link?: string;
  start: string;
  end: string;
  description: string;
}

export interface EducationEntry {
  id: string;
  institution: string;
  degree: string;
  field: string;
  year: string;
  gpa?: string;
  honors?: string;
}

export interface CertEntry {
  id: string;
  name: string;
  issuer: string;
  year: string;
}

export type RoleStatus = "working" | "student";

export interface CareerProfile {
  user_id: string;
  master_resume_id: string | null;
  contact: ContactInfo;
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
  skills: string[];
  certifications: CertEntry[];
  headline: string | null;
  role_status: RoleStatus | null;
  created_at: string;
  updated_at: string;
}

export type CareerProfileInput = Omit<CareerProfile, "user_id" | "created_at" | "updated_at">;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function uid(): Promise<string> {
  const sb = createBrowserClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// ── API ───────────────────────────────────────────────────────────────────────

export async function getCareerProfile(): Promise<CareerProfile | null> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("career_profiles")
    .select("*")
    .eq("user_id", me)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CareerProfile | null;
}

export async function upsertCareerProfile(input: CareerProfileInput): Promise<CareerProfile> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("career_profiles")
    .upsert({ user_id: me, ...input }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CareerProfile;
}

export async function setProfileMasterResume(resumeId: string): Promise<void> {
  const sb = createBrowserClient();
  const me = await uid();
  const { error } = await sb
    .from("career_profiles")
    .upsert({ user_id: me, master_resume_id: resumeId }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

/** Infer full-time vs internship from a parsed role's title/company text —
 * used when seeding an experience entry from an uploaded resume, which has
 * no structured "type" field of its own to carry over. Matches "intern" or
 * "internship" as a whole word (case-insensitive) so "International" doesn't
 * false-positive. */
export function inferExpType(title: string, company: string): ExpType {
  return /\bintern(ship)?\b/i.test(`${title} ${company}`) ? "internship" : "full-time";
}

/** Convert a parsed/uploaded resume's content into a CareerProfileInput, so an
 * uploaded resume can seed the career profile (used by onboarding and the
 * profile page's "upload resume" flow). */
export function resumeContentToCareerProfileInput(
  c: ResumeContent,
  masterResumeId: string | null
): CareerProfileInput {
  return {
    master_resume_id: masterResumeId,
    contact: {
      name: c.contact?.name ?? "",
      email: c.contact?.email ?? "",
      phone: c.contact?.phone ?? "",
      location: c.contact?.location ?? "",
      linkedin: c.contact?.linkedin ?? "",
      github: c.contact?.github ?? "",
    },
    headline: c.headline ?? null,
    skills: Array.isArray(c.skills) ? c.skills : [],
    experience: Array.isArray(c.experience)
      ? c.experience.map((e) => ({
          id: crypto.randomUUID(),
          type: inferExpType(e.title, e.company),
          company: e.company,
          title: e.title,
          start: e.start,
          end: e.end || "Present",
          current: !e.end || e.end === "Present",
          responsibilities: (e.bullets ?? []).join("; "),
          achievements: "",
          projects: "",
          impact: "",
        }))
      : [],
    projects: Array.isArray(c.projects)
      ? c.projects.map((p) => ({
          id: crypto.randomUUID(),
          name: p.name,
          techStack: p.tech_stack ?? "",
          link: p.link ?? "",
          start: p.start ?? "",
          end: p.end ?? "",
          description: (p.bullets ?? []).join("; "),
        }))
      : [],
    education: Array.isArray(c.education)
      ? c.education.map((e) => ({
          id: crypto.randomUUID(),
          institution: e.institution,
          degree: e.degree,
          field: "",
          year: e.year,
          gpa: "",
          honors: "",
        }))
      : [],
    certifications: Array.isArray(c.certifications)
      ? c.certifications.map((name) => ({ id: crypto.randomUUID(), name, issuer: "", year: "" }))
      : [],
    role_status: null,
  };
}

/** Convert a CareerProfile into a ResumeContent-compatible object for tailoring
 * and for keeping the master resume's stored content in sync with profile edits. */
export function profileToResumeContent(profile: CareerProfileInput): ResumeContent {
  return {
    contact: profile.contact,
    headline: profile.headline ?? undefined,
    experience: profile.experience.map(e => ({
      company: `${e.company}${e.type === "internship" ? " (Internship)" : ""}`,
      title: e.title,
      start: e.start,
      end: e.current ? "Present" : e.end || "Present",
      bullets: [
        e.responsibilities && `Responsibilities: ${e.responsibilities}`,
        e.achievements && `Achievements: ${e.achievements}`,
        e.projects && `Projects: ${e.projects}`,
        e.impact && `Impact: ${e.impact}`,
      ].filter(Boolean),
    })),
    projects: profile.projects.map(p => ({
      name: p.name,
      tech_stack: p.techStack || undefined,
      link: p.link || undefined,
      start: p.start || undefined,
      end: p.end || undefined,
      bullets: p.description
        ? p.description.split(/\n|;/).map(s => s.trim()).filter(Boolean)
        : [],
    })),
    education: profile.education.map(e => ({
      institution: e.institution,
      degree: `${e.degree}${e.field ? ` in ${e.field}` : ""}`,
      year: e.year,
    })),
    skills: profile.skills,
    certifications: profile.certifications.map(c => `${c.name}${c.issuer ? ` — ${c.issuer}` : ""}`),
  };
}
