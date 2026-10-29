import type { ResumeContent } from "@career-copilot/types";

/** Where a Miscellaneous point fits on a résumé. The AI suggests one when the
 * point is saved; "miscellaneous" means nothing clearly fits and the user
 * picks a place in the review. Mirrors MISC_SECTIONS in
 * apps/api/app/services/misc_notes.py. */
export const MISC_SECTIONS = [
  "experience", "project", "achievements", "awards",
  "leadership", "volunteer", "skills", "miscellaneous",
] as const;
export type MiscSection = (typeof MISC_SECTIONS)[number];

export const MISC_SECTION_LABEL: Record<MiscSection, string> = {
  experience: "Experience",
  project: "Project",
  achievements: "Achievements",
  awards: "Awards",
  leadership: "Leadership",
  volunteer: "Volunteer",
  skills: "Skills",
  miscellaneous: "Miscellaneous",
};

/** A fact the user saved about themselves from the notes canvas. */
export interface MiscPoint {
  id: string;
  /** The tidied point, as it would print. */
  text: string;
  section: MiscSection;
  created_at: string;
}

export const MAX_MISC_POINTS = 50;
export const MAX_NOTE_CHARS = 2000;
/** CREDIT_COSTS["restructure_notes"] in apps/api/app/core/credits.py. */
export const RESTRUCTURE_NOTES_CREDITS = 1;

/** Sections whose points are written as résumé bullets, and the length a
 * strong one runs — HARD_LIMITS["bullet_words"] in resume_spec.py. */
export const BULLET_SECTIONS: ReadonlySet<MiscSection> = new Set(["experience", "project", "leadership", "volunteer"]);
export const BULLET_WORDS = { preferMin: 15, preferMax: 28, max: 35 } as const;

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function isMiscSection(s: string): s is MiscSection {
  return (MISC_SECTIONS as readonly string[]).includes(s);
}

/** The résumé lists a point can be added to as an item. */
export const LIST_SECTIONS = ["achievements", "awards", "leadership", "volunteer"] as const;
export type ListSection = (typeof LIST_SECTIONS)[number];

/** Where a point goes on one résumé: a bullet under experience entry `i`
 * ("exp:i") or project `i` ("proj:i"), a list section, the skills, or ""
 * when no place has been chosen yet. Picked per review, never saved. */
export type MiscDestination = `exp:${number}` | `proj:${number}` | ListSection | "skills" | "";

/** Where a point goes unless the user picks otherwise: the section it was
 * saved under, the most recent role or project for a bullet, and
 * Achievements for a bullet whose résumé has no such entry. */
export function defaultDestination(point: MiscPoint, content: ResumeContent): MiscDestination {
  switch (point.section) {
    case "experience":
      return content.experience.length > 0 ? "exp:0" : "achievements";
    case "project":
      return (content.projects?.length ?? 0) > 0 ? "proj:0" : "achievements";
    case "miscellaneous":
      return "";
    default:
      return point.section;
  }
}

export function destinationOptions(content: ResumeContent): { value: MiscDestination; label: string }[] {
  return [
    ...content.experience.map((e, i) => ({
      value: `exp:${i}` as const,
      label: `Bullet in ${[e.title, e.company].filter(Boolean).join(" · ") || "Untitled role"}`,
    })),
    ...(content.projects ?? []).map((p, i) => ({
      value: `proj:${i}` as const,
      label: `Bullet in ${p.name || "Untitled project"}`,
    })),
    { value: "achievements", label: "Achievements" },
    { value: "awards", label: "Awards" },
    { value: "leadership", label: "Leadership" },
    { value: "volunteer", label: "Volunteer" },
    { value: "skills", label: "Skills" },
  ];
}
