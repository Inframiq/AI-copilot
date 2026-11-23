/**
 * How the Profile lays itself out for the status set on it.
 *
 * A student's résumé leads with the degree, then projects and internships;
 * a working professional's with experience. The Profile follows the same
 * order so it reads like the résumé it makes. Nothing is hidden or locked:
 * every section stays on the page (or in "+ Add section"), switching the
 * status only reorders, relabels and changes which sections are suggested
 * first. No status yet is laid out as a working professional — the Profile
 * as it always was.
 *
 * Every status opens with the Professional summary (2026-11-24, the user's
 * call: Indian campus hiring prefers a short summary to a career
 * objective). A student's Career objective is still on offer in
 * "+ Add section", and one already written stays on the page.
 */
import type { RoleStatus } from "@/lib/career-profile-client";
import { SECTION_INFO, type ExtraSection } from "@/lib/profile-sections";

/** The sections that are always on the Profile, in the order they show. */
export type MainSection = "skills" | "experience" | "projects" | "education" | "certifications";

/** What "+ Add section" can offer. */
export type OptionalSection = ExtraSection;

export interface ProfileLayout {
  student: boolean;
  /** The summary box's example, in the voice of the résumé it starts. */
  summaryPlaceholder: string;
  main: MainSection[];
  /** Optional sections, most relevant first: the order "+ Add section"
   * suggests them and the order their cards show. */
  optional: OptionalSection[];
  /** The Experience section's add button and empty state. */
  addExperienceLabel: string;
  firstExperienceLabel: string;
}

export const OPTIONAL_INFO: Record<OptionalSection, { label: string; hint: string }> = SECTION_INFO;

export function profileLayout(status: RoleStatus | "" | null | undefined): ProfileLayout {
  if (status === "student") {
    return {
      student: true,
      summaryPlaceholder:
        "Computer Science student (Bachelor of Technology) who built a campus marketplace app in React and Node.js…",
      main: ["education", "projects", "experience", "skills", "certifications"],
      optional: ["coursework", "leadership", "awards", "achievements", "volunteer", "languages", "interests", "objective"],
      addExperienceLabel: "Add Internship",
      firstExperienceLabel: "Add your first internship",
    };
  }
  return {
    student: false,
    summaryPlaceholder: "Backend engineer with four years building payment APIs in Go and PostgreSQL…",
    main: ["skills", "experience", "projects", "education", "certifications"],
    optional: ["languages", "awards", "achievements", "leadership", "volunteer", "interests", "coursework", "objective"],
    addExperienceLabel: "Add Experience",
    firstExperienceLabel: "Add your first experience",
  };
}
