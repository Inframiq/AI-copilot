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
 */
import type { RoleStatus } from "@/lib/career-profile-client";
import { SECTION_INFO, type ExtraSection } from "@/lib/profile-sections";

/** The always-shown statement card: a student's Career objective or a
 * professional's summary. */
export type Statement = "summary" | "objective";

/** The sections that are always on the Profile, in the order they show. */
export type MainSection = "skills" | "experience" | "projects" | "education" | "certifications";

/** What "+ Add section" can offer: the optional sections, plus whichever
 * statement is not the pinned one. */
export type OptionalSection = ExtraSection | "summary";

export interface ProfileLayout {
  student: boolean;
  statement: Statement;
  statementLabel: string;
  main: MainSection[];
  /** Optional sections, most relevant first: the order "+ Add section"
   * suggests them and the order their cards show. */
  optional: OptionalSection[];
  /** The Experience section's add button and empty state. */
  addExperienceLabel: string;
  firstExperienceLabel: string;
}

export const OPTIONAL_INFO: Record<OptionalSection, { label: string; hint: string }> = {
  ...SECTION_INFO,
  summary: {
    label: "Professional summary",
    hint: "Two or three sentences on who you are and what you do best.",
  },
};

export function profileLayout(status: RoleStatus | "" | null | undefined): ProfileLayout {
  if (status === "student") {
    return {
      student: true,
      statement: "objective",
      statementLabel: "Career objective",
      main: ["education", "projects", "experience", "skills", "certifications"],
      optional: ["coursework", "leadership", "awards", "achievements", "volunteer", "languages", "interests", "summary"],
      addExperienceLabel: "Add Internship",
      firstExperienceLabel: "Add your first internship",
    };
  }
  return {
    student: false,
    statement: "summary",
    statementLabel: "Professional summary",
    main: ["skills", "experience", "projects", "education", "certifications"],
    optional: ["languages", "awards", "achievements", "leadership", "volunteer", "interests", "coursework", "objective"],
    addExperienceLabel: "Add Experience",
    firstExperienceLabel: "Add your first experience",
  };
}
