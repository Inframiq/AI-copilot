/**
 * The résumé fonts, for the Studio.
 *
 * The PDF embeds fonts bundled with the API (apps/api/fonts, see build.py
 * there) instead of whatever the render host has: the text an ATS pulls out
 * of a PDF depends on the font actually embedded. The same files are served
 * from /fonts/resume/ here and registered under the same family names, so the
 * document on screen breaks its lines where the PDF will.
 *
 * Must stay in step with FONT_STACKS and BUNDLED_FONTS in
 * apps/api/app/services/pdf.py; apps/api/tests/test_resume_fonts.py checks
 * the stacks, the family names and that the font files are the same bytes.
 */

export const RESUME_FONT_STACKS = {
  sans: '"Resume Sans", Arial, Helvetica, sans-serif',
  modern_sans: '"Resume Lato", Lato, Arial, sans-serif',
  serif: '"Resume Georgia", Georgia, "Times New Roman", serif',
  classic_serif: '"Resume Times", "Times New Roman", Times, serif',
} as const;

export type FontChoice = keyof typeof RESUME_FONT_STACKS;

/** Family → file prefix under /fonts/resume/. */
export const RESUME_FONT_FILES: Record<string, string> = {
  "Resume Sans": "LiberationSans",
  "Resume Lato": "Lato",
  "Resume Georgia": "Gelasio",
  "Resume Times": "LiberationSerif",
};

const FACES = [
  { suffix: "Regular", weight: 400, style: "normal" },
  { suffix: "Bold", weight: 700, style: "normal" },
  { suffix: "Italic", weight: 400, style: "italic" },
  { suffix: "BoldItalic", weight: 700, style: "italic" },
] as const;

/** Every @font-face rule, for a stylesheet in the document's own head. */
export function resumeFontFaceCss(): string {
  return Object.entries(RESUME_FONT_FILES)
    .flatMap(([family, file]) =>
      FACES.map(
        (f) =>
          `@font-face { font-family: "${family}"; font-weight: ${f.weight}; font-style: ${f.style}; ` +
          `font-display: swap; src: url("/fonts/resume/${file}-${f.suffix}.ttf") format("truetype"); }`,
      ),
    )
    .join("\n");
}

const STYLE_ID = "resume-fonts";

/**
 * Registers the résumé fonts once per page. In the document's head, not in
 * the canvas's shadow root: a browser does not load @font-face rules
 * declared inside a shadow tree, while fonts declared on the document are
 * usable from inside one. The browser fetches a file only once a face is
 * actually drawn.
 */
export function ensureResumeFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = resumeFontFaceCss();
  document.head.appendChild(style);
}
