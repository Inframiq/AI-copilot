// Drives the section rail's completeness rings. The old tab strip gave no
// signal about what was filled in; these ratios are what replaces that
// silence. Pure and store-free so the thresholds can be tested directly.

import type { ResumeContent } from "@career-copilot/types";
import { LINE_SECTIONS } from "@/lib/profile-sections";
import { allRolePoints } from "@/lib/work-projects";

export type SectionId =
  | "contact"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "extras";

export interface SectionState {
  id: SectionId;
  label: string;
  /** 0..1 — how filled this section is. */
  ratio: number;
  complete: boolean;
}

/** Skills past this count add no more ring; eight reads as a full set. */
const SKILLS_TARGET = 8;

const filled = (v: string | undefined | null) => !!v && v.trim().length > 0;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function contactRatio(content: ResumeContent): number {
  const c = content.contact;
  const fields = [c.name, c.email, c.phone, c.location, c.linkedin, c.github];
  return fields.filter(filled).length / fields.length;
}

function experienceRatio(content: ResumeContent): number {
  if (content.experience.length === 0) return 0;
  // A role with no bullets is half an entry — it renders as a heading with
  // nothing under it, which is the most common half-finished state.
  const scored = content.experience.map((job) => {
    const hasRole = filled(job.company) || filled(job.title);
    // A role's projects' points count as its points.
    const hasBullets = allRolePoints(job).some(filled);
    return (hasRole ? 0.5 : 0) + (hasBullets ? 0.5 : 0);
  });
  return clamp01(scored.reduce((a, b) => a + b, 0) / content.experience.length);
}

function educationRatio(content: ResumeContent): number {
  if (content.education.length === 0) return 0;
  const scored = content.education.map((e) =>
    filled(e.institution) && filled(e.degree) ? 1 : 0.5
  );
  return clamp01(scored.reduce((a, b) => a + b, 0) / content.education.length);
}

/** Extras filled for a full ring: nobody fills all seven, and three
 * (languages, certifications and one more, say) already reads complete. */
const EXTRAS_TARGET = 3;

function extrasRatio(content: ResumeContent): number {
  const lists = [content.languages, content.certifications, ...LINE_SECTIONS.map((k) => content[k])];
  return clamp01(lists.filter((l) => (l ?? []).length > 0).length / EXTRAS_TARGET);
}

const LABELS: Record<SectionId, string> = {
  contact: "Contact",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  extras: "Extras",
};

export function sectionStates(content: ResumeContent | null): SectionState[] {
  const ratios: Record<SectionId, number> = content
    ? {
        contact: contactRatio(content),
        summary: filled(content.summary) ? 1 : 0,
        experience: experienceRatio(content),
        education: educationRatio(content),
        skills: clamp01(content.skills.filter(filled).length / SKILLS_TARGET),
        extras: extrasRatio(content),
      }
    : { contact: 0, summary: 0, experience: 0, education: 0, skills: 0, extras: 0 };

  return (Object.keys(LABELS) as SectionId[]).map((id) => ({
    id,
    label: LABELS[id],
    ratio: ratios[id],
    complete: ratios[id] >= 1,
  }));
}

export function completeCount(states: SectionState[]): {
  complete: number;
  total: number;
} {
  return {
    complete: states.filter((s) => s.complete).length,
    total: states.length,
  };
}

/** Canonical Builder order. sectionStates() already returns this order; this
 * export exists so navigation can reason about neighbours without depending
 * on array positions in its return value. */
export const SECTION_ORDER: SectionId[] = [
  "contact",
  "summary",
  "experience",
  "education",
  "skills",
  "extras",
];
