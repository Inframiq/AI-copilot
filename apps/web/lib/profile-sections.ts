import type { ResumeContent } from "@career-copilot/types";

/**
 * The résumé sections the Profile holds beyond contact, skills, experience,
 * projects, education and certifications. One list for the Profile page
 * (its "Add section" sheet), the Résumé Builder's editors and the mappings
 * between a profile and a résumé (lib/career-profile-client.ts), so a
 * section added to one is added to all of them — the guard test
 * (profile-sections.test.ts) fails otherwise.
 *
 * Summary isn't listed: the Profile always shows it.
 */
export const LINE_SECTIONS = ["awards", "achievements", "leadership", "volunteer", "interests"] as const;
export type LineSection = (typeof LINE_SECTIONS)[number];

export const EXTRA_SECTIONS = ["objective", "languages", ...LINE_SECTIONS] as const;
export type ExtraSection = (typeof EXTRA_SECTIONS)[number];

export const SECTION_INFO: Record<ExtraSection, { label: string; hint: string; placeholder: string; item: string }> = {
  objective: {
    item: "objective",
    label: "Objective",
    hint: "The role you're aiming for — useful for students and career changers.",
    placeholder: "Final-year CS student seeking a backend engineering internship…",
  },
  languages: {
    item: "language",
    label: "Languages",
    hint: "Languages you speak, and how well: Native, Fluent, B2.",
    placeholder: "e.g. Spanish",
  },
  awards: {
    item: "award",
    label: "Awards",
    hint: "Prizes, scholarships and honours: Dean's List, a hackathon win.",
    placeholder: "Dean's List, 2024",
  },
  achievements: {
    item: "achievement",
    label: "Achievements",
    hint: "Results worth naming: ranks, scores, publications, milestones.",
    placeholder: "98.6 percentile, CAT 2024",
  },
  leadership: {
    item: "role",
    label: "Leadership",
    hint: "Clubs, class rep, team lead, event organiser.",
    placeholder: "President, Coding Club — ran weekly sessions for 60 students",
  },
  volunteer: {
    item: "role",
    label: "Volunteer",
    hint: "Unpaid work: NGOs, teaching, community drives.",
    placeholder: "Taught basic computing at a government school on weekends",
  },
  interests: {
    item: "interest",
    label: "Interests",
    hint: "Hobbies and interests: chess, trekking, open source.",
    placeholder: "Chess",
  },
};

/** What the database accepts (migration 053) — the forms keep inside it. */
export const PROFILE_LIMITS = {
  summaryWords: 80,
  summaryChars: 1000,
  objectiveWords: 50,
  objectiveChars: 600,
  languages: 15,
  languageChars: 100,
  items: 20,
  itemChars: 300,
} as const;

export interface LanguageEntry {
  name: string;
  level: string;
}

/** The sections as the Profile stores them. */
export interface ProfileSections {
  summary: string | null;
  objective: string | null;
  languages: LanguageEntry[];
  awards: string[];
  achievements: string[];
  leadership: string[];
  volunteer: string[];
  interests: string[];
}

export function emptyProfileSections(): ProfileSections {
  return {
    summary: null, objective: null, languages: [],
    awards: [], achievements: [], leadership: [], volunteer: [], interests: [],
  };
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** `value` cut to `max` words, from the end, so what was typed first stays. */
export function capWords(value: string, max: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? value : words.slice(0, max).join(" ");
}

/**
 * The sections in a shape the database accepts: blanks dropped, text
 * trimmed, and anything past a limit cut off. An uploaded résumé can hold
 * more than the Profile keeps; a save must never fail over it.
 */
export function fitProfileSections(s: Partial<ProfileSections>): ProfileSections {
  const L = PROFILE_LIMITS;
  const lines = (v: unknown) =>
    (Array.isArray(v) ? v : []).map(text).filter(Boolean).slice(0, L.items).map((t) => t.slice(0, L.itemChars));
  return {
    summary: text(s.summary).slice(0, L.summaryChars) || null,
    objective: text(s.objective).slice(0, L.objectiveChars) || null,
    languages: (Array.isArray(s.languages) ? s.languages : [])
      .map((l) => ({ name: text(l?.name).slice(0, L.languageChars), level: text(l?.level).slice(0, L.languageChars) }))
      .filter((l) => l.name)
      .slice(0, L.languages),
    awards: lines(s.awards),
    achievements: lines(s.achievements),
    leadership: lines(s.leadership),
    volunteer: lines(s.volunteer),
    interests: lines(s.interests),
  };
}

/** A résumé's sections as the Profile keeps them (an upload filling the
 * Profile). */
export function resumeSectionsToProfile(c: ResumeContent): ProfileSections {
  return fitProfileSections({
    summary: c.summary ?? null,
    objective: c.objective ?? null,
    languages: (c.languages ?? []).map((l) => ({ name: l?.name ?? "", level: l?.level ?? "" })),
    awards: c.awards,
    achievements: c.achievements,
    leadership: c.leadership,
    volunteer: c.volunteer,
    interests: c.interests,
  });
}

/** The Profile's sections as a résumé carries them (a résumé started from
 * the Profile). Empty ones are left off. */
export function profileSectionsToResume(s: Partial<ProfileSections>): Partial<ResumeContent> {
  const fit = fitProfileSections(s);
  const out: Partial<ResumeContent> = {};
  if (fit.summary) out.summary = fit.summary;
  if (fit.objective) out.objective = fit.objective;
  if (fit.languages.length) out.languages = fit.languages;
  for (const key of LINE_SECTIONS) if (fit[key].length) out[key] = fit[key];
  return out;
}

/** Whether a section has anything in it — the Profile shows those. */
export function sectionHasContent(s: Partial<ProfileSections>, key: ExtraSection): boolean {
  const v = s[key];
  if (key === "objective") return !!text(v);
  return Array.isArray(v) && v.length > 0;
}
