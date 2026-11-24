/**
 * Profile Health: how complete My Profile is (career_profiles, the app's
 * source of truth — never a résumé, so deleting or adding résumés doesn't
 * move it; the Profile's own upload and Save do).
 *
 * It used to be ten yes/no checks, 10% each: a job with no dates and no
 * points counted as "experience", any five skills as "skills", and the
 * summary wasn't asked about at all, so a profile read from one upload sat
 * at 80% with much of it half filled. Now each part counts by how much of
 * it is filled in, and the card names the one step that adds the most.
 *
 *   contact 20 (name, email, phone, location, LinkedIn — 4 each)
 *   headline 10 · summary 15 · work 25 · education 15 · skills 15
 *
 * Work is the jobs, each counted when it has a title, company, start, an
 * end (or "current") and points. A student's work is their projects and
 * internships together: a project counts with a name and a description.
 * GitHub and a website aren't asked for: plenty of fields have neither.
 */
import type { CareerProfile, EducationEntry, ExperienceEntry, ProjectEntry } from "@/lib/career-profile-client";

export const SKILLS_WANTED = 6;

export interface ProfileHealth {
  score: number;
  /** "Complete", or the one step that adds the most. */
  label: string;
}

const has = (v: unknown) => typeof v === "string" && v.trim() !== "";

function jobHasPoints(e: ExperienceEntry): boolean {
  return (
    [e.responsibilities, e.achievements, e.impact].some(has) ||
    (e.workProjects ?? []).some((p) => [p.responsibilities, p.achievements, p.impact].some(has))
  );
}

function jobHasDates(e: ExperienceEntry): boolean {
  return has(e.start) && (e.current || has(e.end));
}

function jobComplete(e: ExperienceEntry): boolean {
  return has(e.title) && has(e.company) && jobHasDates(e) && jobHasPoints(e);
}

function projectComplete(p: ProjectEntry): boolean {
  return has(p.name) && has(p.description);
}

function educationComplete(e: EducationEntry): boolean {
  return has(e.institution) && has(e.degree) && has(e.year);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function computeProfileHealth(profile: CareerProfile | null): ProfileHealth {
  if (!profile) return { score: 0, label: "Finish your profile" };
  const contact = profile.contact ?? { name: "", email: "" };
  const student = profile.role_status === "student";
  const jobs = Array.isArray(profile.experience) ? profile.experience : [];
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const education = Array.isArray(profile.education) ? profile.education : [];
  const skills = Array.isArray(profile.skills) ? profile.skills.filter(has) : [];

  // Each part: the points it's worth, the share of it filled in, and the
  // step that fills the rest.
  const parts: Array<{ weight: number; filled: number; step: string }> = [];

  for (const [field, step] of [
    ["name", "Add your name"],
    ["email", "Add your email"],
    ["phone", "Add your phone number"],
    ["location", "Add your location"],
    ["linkedin", "Add your LinkedIn"],
  ] as const) {
    parts.push({ weight: 4, filled: has(contact[field]) ? 1 : 0, step });
  }
  parts.push({ weight: 10, filled: has(profile.headline) ? 1 : 0, step: "Add a headline" });
  // A student's Career objective still stands in for the summary.
  const summary = has(profile.summary) || (student && has(profile.objective));
  parts.push({ weight: 15, filled: summary ? 1 : 0, step: "Add a professional summary" });

  if (student) {
    const entries = jobs.length + projects.length;
    const openProjects = projects.filter((p) => !projectComplete(p)).length;
    const openInternships = jobs.filter((e) => !jobComplete(e)).length;
    parts.push({
      weight: 25,
      filled: entries ? (entries - openProjects - openInternships) / entries : 0,
      // Short enough for the dashboard card: one kind named at a time.
      step: !entries
        ? "Add a project or internship"
        : openProjects
          ? `Finish ${plural(openProjects, "project", "projects")}`
          : `Finish ${plural(openInternships, "internship", "internships")}`,
    });
  } else {
    const done = jobs.filter(jobComplete).length;
    const noPoints = jobs.filter((e) => !jobHasPoints(e)).length;
    const noDates = jobs.filter((e) => !jobHasDates(e)).length;
    parts.push({
      weight: 25,
      filled: jobs.length ? done / jobs.length : 0,
      step: !jobs.length
        ? "Add your experience"
        : noPoints
          ? `Add points to ${plural(noPoints, "job", "jobs")}`
          : noDates
            ? `Add dates to ${plural(noDates, "job", "jobs")}`
            : `Finish ${plural(jobs.length - done, "job", "jobs")}`,
    });
  }

  const eduDone = education.filter(educationComplete).length;
  parts.push({
    weight: 15,
    filled: education.length ? eduDone / education.length : 0,
    step: education.length
      ? `Finish ${plural(education.length - eduDone, "education entry", "education entries")}`
      : "Add your education",
  });
  const moreSkills = Math.max(0, SKILLS_WANTED - skills.length);
  parts.push({
    weight: 15,
    filled: Math.min(skills.length, SKILLS_WANTED) / SKILLS_WANTED,
    step: `Add ${plural(moreSkills, "more skill", "more skills")}`,
  });

  const score = Math.round(parts.reduce((sum, p) => sum + p.weight * p.filled, 0));
  // The step worth the most points still missing; the first such on a tie.
  let best: (typeof parts)[number] | null = null;
  for (const p of parts) {
    const missing = p.weight * (1 - p.filled);
    if (missing > 1e-9 && (!best || missing > best.weight * (1 - best.filled) + 1e-9)) best = p;
  }
  return { score, label: best ? best.step : "Complete" };
}
