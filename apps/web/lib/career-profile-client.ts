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

// ── Same-company grouping + tenure duration ─────────────────────────────────
// Shared by the Profile page (per-role + total-at-company duration display)
// and the Resume Builder's EditorPanel (the "merge into one entry" offer for
// two roles at the same company — a promotion or internal transfer). Both
// need the identical adjacency rule so the two screens never disagree about
// which roles "belong together" — matching the same rule the PDF templates
// use server-side (pdf.py's _group_experience_by_company) to group these
// under one company header.

/** Same company, case/whitespace-insensitive. Blank/missing company never
 * matches anything, even itself. */
export function sameCompany(a?: string, b?: string): boolean {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  return na !== "" && na === nb;
}

const MONTH_ABBREVIATIONS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/** Parses the free-text date strings this app's forms actually produce —
 * "Jan 2022" / "January 2022" (month + year) or a bare "2022" (year only,
 * treated as January of that year for duration math). Returns null for
 * anything else rather than guessing, so a duration is only ever shown when
 * it can be computed honestly. */
function parseResumeDate(raw: string | undefined): { year: number; month: number } | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const monthYear = s.match(/^([a-z]{3,9})\.?\s+(\d{4})$/);
  if (monthYear) {
    const monthIndex = MONTH_ABBREVIATIONS.indexOf(monthYear[1].slice(0, 3));
    if (monthIndex !== -1) return { year: parseInt(monthYear[2], 10), month: monthIndex };
  }
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) return { year: parseInt(yearOnly[1], 10), month: 0 };
  return null;
}

function isPresent(end: string | undefined, current: boolean): boolean {
  return current || (end ?? "").trim().toLowerCase() === "present";
}

/** Total whole months spanned by [start, end] inclusive of the start month
 * (the standard resume-duration convention: Jan-Jan is "1 mo", not "0 mo").
 * null when either date can't be parsed, or when the range is inverted
 * (a malformed end-before-start pair) — never guess at a nonsense duration. */
function monthsBetween(start: string | undefined, end: string | undefined, current: boolean): number | null {
  const startDate = parseResumeDate(start);
  if (!startDate) return null;
  let endDate: { year: number; month: number };
  if (isPresent(end, current)) {
    const now = new Date();
    endDate = { year: now.getFullYear(), month: now.getMonth() };
  } else {
    const parsed = parseResumeDate(end);
    if (!parsed) return null;
    endDate = parsed;
  }
  const total = (endDate.year - startDate.year) * 12 + (endDate.month - startDate.month) + 1;
  return total > 0 ? total : null;
}

function formatMonths(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years > 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} mo${months > 1 ? "s" : ""}`);
  return parts.join(" ");
}

/** "1 yr 4 mos" for a single role's start/end — null when the dates can't
 * be parsed (never shown rather than shown wrong) or round to 0 months. */
export function formatRoleDuration(
  start: string | undefined, end: string | undefined, current: boolean
): string | null {
  const totalMonths = monthsBetween(start, end, current);
  return totalMonths ? formatMonths(totalMonths) : null;
}

/** Total tenure across every role in an adjacent same-company group — from
 * the earliest role's start to the latest role's end (or "Present") — not
 * just a sum of the individual roles' durations, so a gap between two roles
 * at that company (if any) isn't silently double-counted. null when the
 * group's dates can't be parsed. */
export function formatCompanyTotalDuration(
  roles: Array<{ start?: string; end?: string; current?: boolean }>
): string | null {
  if (roles.length === 0) return null;
  const starts = roles.map(r => parseResumeDate(r.start)).filter((d): d is { year: number; month: number } => d !== null);
  if (starts.length === 0) return null;
  const earliestStart = starts.reduce((a, b) => (a.year * 12 + a.month <= b.year * 12 + b.month ? a : b));

  const anyCurrent = roles.some(r => isPresent(r.end, r.current ?? false));
  let latestEnd: { year: number; month: number };
  if (anyCurrent) {
    const now = new Date();
    latestEnd = { year: now.getFullYear(), month: now.getMonth() };
  } else {
    const ends = roles.map(r => parseResumeDate(r.end)).filter((d): d is { year: number; month: number } => d !== null);
    if (ends.length === 0) return null;
    latestEnd = ends.reduce((a, b) => (a.year * 12 + a.month >= b.year * 12 + b.month ? a : b));
  }

  const totalMonths = (latestEnd.year - earliestStart.year) * 12 + (latestEnd.month - earliestStart.month) + 1;
  return totalMonths > 0 ? formatMonths(totalMonths) : null;
}
