export type PhotoShape = "square" | "portrait" | "circle";

export const RESUME_TEMPLATES = [
  { id: "ats_clean", label: "ATS Clean", description: "Simple single-column layout, maximum ATS compatibility." },
  { id: "ats_modern", label: "ATS Modern", description: "Clean sans-serif with subtle color accents." },
  { id: "ats_sidebar", label: "Sidebar", description: "Banner header with photo and language bars.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_professional", label: "Professional", description: "Bold blue headings with a photo.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_minimal", label: "Minimal", description: "Centered header, understated, content-first." },
  { id: "ats_executive", label: "Executive", description: "Centered masthead and engraved rules — senior and formal." },
  { id: "ats_compact", label: "Compact", description: "Dense and space-efficient, for a long history on one page." },
  { id: "ats_banner", label: "Banner", description: "Full-bleed color header with your name reversed out of it." },
  { id: "ats_portrait", label: "Portrait", description: "Centered circular photo above a formal masthead.", photo: { shape: "circle" as PhotoShape } },
  { id: "ats_technical", label: "Technical", description: "Skills first, accent ticks, built for engineering roles." },
] as const;

/** True when the given template id renders a profile photo. Single source of
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
