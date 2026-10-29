"use client";
import { createBrowserClient } from "@/lib/supabase";
import type { ResumeContent, WorkProject } from "@career-copilot/types";
import { MAX_MISC_POINTS, type MiscPoint } from "@/lib/misc-points";
import {
  EXTRA_SECTIONS,
  fitProfileSections,
  profileSectionsToResume,
  resumeSectionsToProfile,
  type ProfileSections,
} from "@/lib/profile-sections";
import { tidyContactLinks } from "@/lib/social-links";
import { plainDeep } from "@/lib/plain-text";
import { isPresent as saysPresent, tidyDate } from "@/lib/month-year";

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
  /** Where the role was based. Carried through both mappings below —
   *  they rebuild each entry field by field, so anything not named here
   *  is dropped the first time a résumé passes through the profile. */
  location: string;
  start: string;
  end: string;
  current: boolean;
  responsibilities: string;
  achievements: string;
  /** The free-text Projects box from before project cards. Kept under its
   *  own key — a tab still running the old code reads it as text — and
   *  moved into the first card (withWorkProjects) the next time it's read. */
  projects: string;
  impact: string;
  /** The role's projects: one per client at a services company, or any
   *  project the role was made of. Absent on entries saved before cards. */
  workProjects?: WorkProjectEntry[];
}

/** A project inside an experience entry, as the Profile keeps it — every
 *  field optional; a résumé prints client (or name) · domain · role, its
 *  dates and its points (lib/work-projects). */
export interface WorkProjectEntry {
  id: string;
  client: string;
  name: string;
  /** The role on this project ("Module Lead"); can differ from the
   *  designation on the entry. */
  role: string;
  domain: string;
  start: string;
  end: string;
  techStack: string;
  responsibilities: string;
  achievements: string;
  impact: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  techStack: string;
  link?: string;
  /** What the link shows instead of its URL. Not edited here, only kept. */
  linkLabel?: string;
  /** Where the project runs, beside `link` (usually its source). */
  liveLink?: string;
  liveLinkLabel?: string;
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

/** Summary, Objective, Languages, Awards… (lib/profile-sections.ts) are
 * optional here: a database without migration 053 has no such columns. */
export interface CareerProfile extends Partial<ProfileSections> {
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
  /** Public URL of the user's default profile photo in the "avatars" bucket.
   *  null = none set. Distinct from a resume's content.contact.photo_url. */
  photo_url: string | null;
  /** Storage object key for photo_url ("<uid>/profile.<ext>") — kept so a
   *  later replace/remove knows the exact object. null iff photo_url is null. */
  photo_path: string | null;
  /** Points saved from the notes canvas. Absent until migration 009 has
   *  run on the database, which callers read as "not available yet". */
  miscellaneous?: MiscPoint[];
  created_at: string;
  updated_at: string;
}

/** What "Save Profile" writes. Never `miscellaneous`: that column is written
 * only by appendMiscPoints / setMiscPoints, so a save from a stale tab can't
 * drop points saved elsewhere, and a database without migration 009 still
 * saves. Sections are written only when given — a caller that doesn't deal
 * in them (saving a photo) leaves them as they are; the Profile page gives
 * them all, so clearing one there clears it. */
export type CareerProfileInput = Omit<
  CareerProfile, "user_id" | "created_at" | "updated_at" | "miscellaneous"
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECTION_KEYS = ["summary", ...EXTRA_SECTIONS] as const satisfies readonly (keyof ProfileSections)[];

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
  // A profile saved before lib/plain-text existed reads back as keyboard
  // text, which the next save stores.
  return data ? plainDeep(data as CareerProfile) : null;
}

export async function upsertCareerProfile(input: CareerProfileInput): Promise<CareerProfile> {
  const sb = createBrowserClient();
  const me = await uid();
  // Callers often pass a whole loaded CareerProfile, which TypeScript accepts
  // as an input. Stripped here so its (possibly stale) Miscellaneous never
  // rides along — see CareerProfileInput.
  const { miscellaneous: _misc, ...fields } = input as CareerProfileInput & { miscellaneous?: unknown };
  // Saved as keyboard text: no curly quotes, long dashes or odd spaces
  // (lib/plain-text) — the API does the same for everything it saves.
  Object.assign(fields, plainDeep(fields));
  // Kept inside the database's limits (migration 053), which would refuse
  // the whole save otherwise.
  // LinkedIn and GitHub in their standard form; one that isn't a profile
  // link is left for the database to refuse (migration 054), unless it's
  // an old one saved unchanged.
  const row: Record<string, unknown> = { user_id: me, ...fields, contact: tidyContactLinks(fields.contact ?? {}) };
  const fit = fitProfileSections(fields);
  for (const k of SECTION_KEYS) if (fields[k] !== undefined) row[k] = fit[k];
  const write = () => sb.from("career_profiles").upsert(row, { onConflict: "user_id" }).select().single();
  let { data, error } = await write();
  // PGRST204: a column the database doesn't have — the sections, for the
  // minutes between this code going live and migration 053 running. With
  // nothing in them the save goes ahead without them.
  if (error?.code === "PGRST204") {
    if (Object.keys(profileSectionsToResume(fields)).length > 0) {
      throw new Error("The new profile sections aren't available yet. Try saving again in a few minutes.");
    }
    for (const k of SECTION_KEYS) delete row[k];
    ({ data, error } = await write());
  }
  if (error) throw new Error(error.message);
  return data as CareerProfile;
}

/** Raised when there is no profile row to save Miscellaneous points to. */
export class NoProfileError extends Error {
  constructor() {
    super("Save your profile once first, then your notes can be kept in it.");
    this.name = "NoProfileError";
  }
}

/** Raised when the database has no `miscellaneous` column yet (migration 009). */
export class MiscUnavailableError extends Error {
  constructor() {
    super("Saving notes to your profile isn't available yet.");
    this.name = "MiscUnavailableError";
  }
}

/** Replace the profile's Miscellaneous points. Touches nothing else. */
export async function setMiscPoints(points: MiscPoint[]): Promise<CareerProfile> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("career_profiles")
    .update({ miscellaneous: plainDeep(points) })
    .eq("user_id", me)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CareerProfile;
}

/** Add points to the profile's Miscellaneous, read fresh so points saved in
 * another tab are kept. Throws rather than dropping any that don't fit. */
export async function appendMiscPoints(points: MiscPoint[]): Promise<CareerProfile> {
  const current = await getCareerProfile();
  if (!current) throw new NoProfileError();
  if (!Array.isArray(current.miscellaneous)) throw new MiscUnavailableError();
  const next = [...current.miscellaneous, ...points];
  if (next.length > MAX_MISC_POINTS) {
    throw new Error(
      `Your profile keeps at most ${MAX_MISC_POINTS} points — remove some from Miscellaneous on your profile first.`,
    );
  }
  return setMiscPoints(next);
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
      website: c.contact?.website ?? "",
    },
    headline: c.headline ?? null,
    skills: Array.isArray(c.skills) ? c.skills : [],
    experience: Array.isArray(c.experience)
      ? c.experience.map((e) => ({
          id: crypto.randomUUID(),
          type: inferExpType(e.title, e.company),
          company: e.company,
          title: e.title,
          location: e.location ?? "",
          start: tidyDate(e.start),
          end: tidyDate(e.end) || "Present",
          current: !e.end || saysPresent(e.end),
          responsibilities: (e.bullets ?? []).join("; "),
          achievements: "",
          projects: "",
          impact: "",
          workProjects: (e.projects ?? []).map(resumeProjectToWork),
        }))
      : [],
    projects: Array.isArray(c.projects)
      ? c.projects.map((p) => ({
          id: crypto.randomUUID(),
          name: p.name,
          techStack: p.tech_stack ?? "",
          link: p.link ?? "",
          linkLabel: p.link_label ?? "",
          liveLink: p.live_link ?? "",
          liveLinkLabel: p.live_link_label ?? "",
          start: tidyDate(p.start),
          end: tidyDate(p.end),
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
          gpa: e.gpa ?? "",
          honors: e.honors ?? "",
        }))
      : [],
    certifications: Array.isArray(c.certifications)
      ? c.certifications.map((name) => ({ id: crypto.randomUUID(), name, issuer: "", year: "" }))
      : [],
    role_status: null,
    photo_url: null,
    photo_path: null,
    // Summary, Objective, Languages, Awards… fill the profile's own
    // sections; they used to wait in Miscellaneous.
    ...resumeSectionsToProfile(c),
  };
}

/** Convert a CareerProfile into a ResumeContent-compatible object for tailoring
 * and for keeping the master resume's stored content in sync with profile edits. */
export function profileToResumeContent(profile: CareerProfileInput | CareerProfile): ResumeContent {
  return {
    contact: profile.contact,
    headline: profile.headline ?? undefined,
    ...profileSectionsToResume(profile),
    // The old Projects box becomes the first card first, so a profile saved
    // before cards starts a résumé the same way it would after.
    experience: profile.experience.map(withWorkProjects).map(e => ({
      // As a standard résumé shows an internship: in the title ("Software
      // Engineer Intern"), never as "(Internship)" stuck to the company —
      // which also came back as part of the company name on an upload.
      company: e.company,
      title: internTitle(e),
      ...(e.location?.trim() ? { location: e.location.trim() } : {}),
      start: e.start,
      end: e.current ? "Present" : e.end || "Present",
      // Standard résumé points: one per item, no "Responsibilities:" label.
      bullets: [...resumePoints(e.responsibilities), ...resumePoints(e.achievements), ...resumePoints(e.impact)],
      ...(e.workProjects?.length ? { projects: e.workProjects.map(workToResumeProject) } : {}),
    })),
    projects: profile.projects.map(p => ({
      name: p.name,
      tech_stack: p.techStack || undefined,
      link: p.link || undefined,
      link_label: (p.link && p.linkLabel) || undefined,
      live_link: p.liveLink || undefined,
      live_link_label: (p.liveLink && p.liveLinkLabel) || undefined,
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
      gpa: e.gpa || undefined,
      ...(e.honors?.trim() ? { honors: e.honors.trim() } : {}),
    })),
    skills: profile.skills,
    // "Name - Issuer (Year)", the year as a standard résumé lists it.
    certifications: profile.certifications.map(c =>
      `${c.name}${c.issuer?.trim() ? ` - ${c.issuer.trim()}` : ""}${c.year?.trim() ? ` (${c.year.trim()})` : ""}`),
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

/** A fresh, all-blank experience entry. `overrides` pre-fills fields — used
 * to seed a second role at the same company (company + type carried over). */
export function blankExperienceEntry(
  overrides: Partial<ExperienceEntry> = {},
): ExperienceEntry {
  return {
    id: crypto.randomUUID(),
    type: "full-time",
    company: "",
    title: "",
    location: "",
    start: "",
    end: "",
    current: false,
    responsibilities: "",
    achievements: "",
    projects: "",
    impact: "",
    workProjects: [],
    ...overrides,
  };
}

/** A fresh, all-blank project card. */
export function blankWorkProject(overrides: Partial<WorkProjectEntry> = {}): WorkProjectEntry {
  return {
    id: crypto.randomUUID(),
    client: "", name: "", role: "", domain: "", start: "", end: "", techStack: "",
    responsibilities: "", achievements: "", impact: "",
    ...overrides,
  };
}

/**
 * The entry with its project cards in place: text typed into the old
 * Projects box ("Payment gateway v2, Search re-index") becomes the first
 * card's name, so nothing is lost and a résumé prints it as that project's
 * line — as Responsibilities it printed under a "Responsibilities:" label
 * that misdescribed it. The box is emptied; cards already there follow
 * that one. An entry with neither gets an empty list.
 */
export function withWorkProjects(e: ExperienceEntry): ExperienceEntry {
  const legacy = (e.projects ?? "").trim();
  const cards = e.workProjects ?? [];
  // Also beside cards already there: a tab still on the old code can write
  // the box after cards exist, and the résumé would otherwise drop it.
  if (legacy) {
    return { ...e, projects: "", workProjects: [blankWorkProject({ name: legacy }), ...cards] };
  }
  return { ...e, workProjects: cards };
}

/**
 * A Profile box as standard résumé points: one point per item — the box
 * takes several, one per line or separated by "; " (how an upload fills
 * it) — each without the box's name in front and without a typed bullet
 * mark. A résumé never labels its points "Responsibilities:".
 */
export function resumePoints(text: string | undefined | null): string[] {
  return (text ?? "")
    .split(/\n|;\s+/)
    .map((t) => t.replace(/^\s*(?:[-*•–·]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/** An internship's title as a résumé prints it: "Intern" added unless the
 * title already says so; any other role's title as it is. */
function internTitle(e: Pick<ExperienceEntry, "type" | "title">): string {
  const title = (e.title ?? "").trim();
  if (e.type !== "internship" || /\bintern(ship)?\b/i.test(title)) return e.title;
  return title ? `${title} Intern` : "Intern";
}

/** A card as a résumé carries it: standard points, as a role gets. */
export function workToResumeProject(p: WorkProjectEntry): WorkProject {
  const text = (v: string | undefined) => v?.trim() || undefined;
  return {
    ...(text(p.client) ? { client: text(p.client) } : {}),
    ...(text(p.name) ? { name: text(p.name) } : {}),
    ...(text(p.role) ? { role: text(p.role) } : {}),
    ...(text(p.domain) ? { domain: text(p.domain) } : {}),
    ...(text(p.start) ? { start: text(p.start) } : {}),
    ...(text(p.end) ? { end: text(p.end) } : {}),
    ...(text(p.techStack) ? { tech_stack: text(p.techStack) } : {}),
    bullets: [...resumePoints(p.responsibilities), ...resumePoints(p.achievements), ...resumePoints(p.impact)],
  };
}

/** A résumé's project as a card: its points go into Responsibilities, as a
 *  role's do. */
export function resumeProjectToWork(p: WorkProject): WorkProjectEntry {
  return blankWorkProject({
    client: p.client ?? "", name: p.name ?? "", role: p.role ?? "", domain: p.domain ?? "",
    start: tidyDate(p.start), end: tidyDate(p.end), techStack: p.tech_stack ?? "",
    responsibilities: (p.bullets ?? []).join("; "),
  });
}

/** Insert a new blank role directly after `index`, pre-filled with that
 * role's company and type so the two sit adjacent — the only arrangement
 * the "Multiple roles at {company}" grouping recognises (the PDF and résumé
 * generator apply the same adjacency rule server-side). An out-of-range
 * index returns an unchanged copy. */
export function insertRoleAfter(
  list: ExperienceEntry[],
  index: number,
): ExperienceEntry[] {
  if (index < 0 || index >= list.length) return [...list];
  const anchor = list[index];
  const next = [...list];
  next.splice(
    index + 1,
    0,
    blankExperienceEntry({ company: anchor.company, type: anchor.type }),
  );
  return next;
}

/** Swap the entry at `index` with its neighbour in `direction`. Boundary
 * moves and invalid indexes return an unchanged copy. Lets a user cluster
 * two same-company roles together, or fix the order of an uploaded résumé. */
export function moveExperience(
  list: ExperienceEntry[],
  index: number,
  direction: "up" | "down",
): ExperienceEntry[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return [...list];
  }
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
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
