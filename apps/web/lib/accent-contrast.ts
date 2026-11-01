/**
 * Whether an accent colour reads on the white page.
 *
 * The PDF refuses an accent below 4.5:1 against white and renders the
 * template's own colour instead (MIN_ACCENT_CONTRAST / resolve_accent in
 * apps/api/app/services/pdf.py): near-white headings are hidden text to a
 * recruiter's parsed view. The picker uses this to say so instead of showing
 * a colour the export will not use.
 */

export const MIN_ACCENT_CONTRAST = 4.5;

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Contrast of a #RRGGBB colour against white, or 0 for anything else. */
export function contrastOnWhite(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((h) => channel(parseInt(h, 16)));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

export function accentReadsOnWhite(hex: string): boolean {
  return contrastOnWhite(hex) >= MIN_ACCENT_CONTRAST;
}
