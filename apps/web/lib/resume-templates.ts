export type PhotoShape = "square" | "portrait" | "circle";

export const RESUME_TEMPLATES = [
  { id: "ats_clean", label: "ATS Clean", description: "Simple single-column layout, maximum ATS compatibility." },
  { id: "ats_modern", label: "ATS Modern", description: "Clean sans-serif with subtle color accents." },
  { id: "ats_sidebar", label: "Sidebar", description: "Banner header with photo and language bars.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_professional", label: "Professional", description: "Bold blue headings with a photo.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_minimal", label: "Minimal", description: "Centered header, understated, content-first." },
] as const;

/** True when the given template id renders a profile photo. Single source of
 * truth for the Resume Builder's "this template needs a photo" prompt. The
 * PDF side already gates on `{% if contact.photo_url %}`, so this stays
 * web-only. */
export function templateRequiresPhoto(id: string): boolean {
  return !!RESUME_TEMPLATES.find((t) => t.id === id && "photo" in t);
}
