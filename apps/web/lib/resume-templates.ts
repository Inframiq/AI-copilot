export type PhotoShape = "square" | "portrait" | "circle";

/** The gallery's two tabs. "student": the Student / fresher set — Education
 * right after the Objective, then internships, projects, skills, coursework,
 * leadership and awards. "professional": Summary and Experience lead. Must
 * match TEMPLATE_SETS in apps/api/app/services/pdf.py. */
export type TemplateSet = "student" | "professional";

export const TEMPLATE_SET_LABELS: Record<TemplateSet, string> = {
  student: "Student / fresher",
  professional: "Working professional",
};

export const RESUME_TEMPLATES = [
  { id: "student_clean", set: "student" as TemplateSet, label: "Campus Clean", description: "Education first, then internships and projects. Plain and fully ATS-safe." },
  { id: "student_modern", set: "student" as TemplateSet, label: "Campus Modern", description: "Education first, with subtle colour accents." },
  { id: "student_minimal", set: "student" as TemplateSet, label: "Campus Minimal", description: "Centred name, education first, understated." },
  { id: "student_technical", set: "student" as TemplateSet, label: "Campus Technical", description: "Education first, skills on an accent rail, for engineering roles." },
  { id: "student_collegiate", set: "student" as TemplateSet, label: "Campus Collegiate", description: "The career-centre classic: small-caps headings over hairlines, set in serif.", font: "classic_serif" },
  { id: "student_placement", set: "student" as TemplateSet, label: "Campus Placement", description: "Dense one page for campus drives: CGPA, internships, projects, coursework." },
  { id: "ats_clean", set: "professional" as TemplateSet, label: "ATS Clean", description: "Simple single-column layout, maximum ATS compatibility." },
  { id: "ats_modern", set: "professional" as TemplateSet, label: "ATS Modern", description: "Clean sans-serif with subtle color accents." },
  { id: "ats_sidebar", set: "professional" as TemplateSet, label: "Sidebar", description: "Banner header with photo and language bars.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_professional", set: "professional" as TemplateSet, label: "Professional", description: "Bold blue headings with a photo.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_minimal", set: "professional" as TemplateSet, label: "Minimal", description: "Centered header, understated, content-first." },
  { id: "ats_executive", set: "professional" as TemplateSet, label: "Executive", description: "Centered masthead and engraved rules — senior and formal." },
  { id: "ats_compact", set: "professional" as TemplateSet, label: "Compact", description: "Dense and space-efficient, for a long history on one page." },
  { id: "ats_banner", set: "professional" as TemplateSet, label: "Banner", description: "Full-bleed color header with your name reversed out of it." },
  { id: "ats_portrait", set: "professional" as TemplateSet, label: "Portrait", description: "Centered circular photo above a formal masthead.", photo: { shape: "circle" as PhotoShape } },
  { id: "ats_technical", set: "professional" as TemplateSet, label: "Technical", description: "Skills first, accent ticks, built for engineering roles." },
  { id: "ats_corporate", set: "professional" as TemplateSet, label: "Corporate", description: "Traditional chronological, set in serif, for an established career.", font: "serif" },
  { id: "ats_impact", set: "professional" as TemplateSet, label: "Impact", description: "Hybrid: summary, skills and achievements first, then your work history." },
] as const;

/** The font a résumé starts in when this template is chosen in the Builder:
 * the serif the design was drawn for, else the app's default. Only a
 * starting point — the Type panel changes it like any other résumé's. */
export function startingFontFor(id: string): string | undefined {
  const t = RESUME_TEMPLATES.find((x) => x.id === id);
  return t && "font" in t ? t.font : undefined;
}

/** The templates in one gallery tab, in gallery order. */
export function templatesInSet(set: TemplateSet) {
  return RESUME_TEMPLATES.filter((t) => t.set === set);
}

/** The tab a template belongs to; professional for an unknown id. */
export function setOfTemplate(id: string): TemplateSet {
  return RESUME_TEMPLATES.find((t) => t.id === id)?.set ?? "professional";
}

/** True when the given template id renders a profile photo. These are the
 * templates the ATS reference would keep off job portals: the gallery labels
 * them, and the ATS check (POST /resumes/{id}/ats-check) flags them.
 * Single source of
 * truth for the Resume Builder's "this template needs a photo" prompt. The
 * PDF side already gates on `{% if contact.photo_url %}`, so this stays
 * web-only.
 *
 * Must stay in step with pdf.py's TEMPLATES_REQUIRING_PHOTO — a template
 * listed there but not here renders a refusal the user is never asked to
 * fix. templates-in-step.test.ts pins the two lists together. */
export function templateRequiresPhoto(id: string): boolean {
  return !!RESUME_TEMPLATES.find((t) => t.id === id && "photo" in t);
}
