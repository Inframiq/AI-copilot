/**
 * The shape of the page the document will actually be printed on.
 *
 * The Studio shows the same HTML WeasyPrint will paginate, but a browser
 * ignores `@page` entirely: it neither applies the margin nor breaks the flow
 * into pages. Reading the rule ourselves gives the canvas the right width —
 * without which its line breaks are not the PDF's — and the page height the
 * boundary markers are spaced by.
 *
 * Verified against a real render: laying the document out at these numbers
 * and dividing by contentHeight reproduces WeasyPrint's own page count across
 * one-, two- and three-page résumés.
 */
const PX_PER_IN = 96;
const UNITS: Record<string, number> = {
  in: PX_PER_IN,
  pt: PX_PER_IN / 72,
  pc: PX_PER_IN / 6,
  mm: PX_PER_IN / 25.4,
  cm: PX_PER_IN / 2.54,
  px: 1,
};

// Inches. A4 is first because it is WeasyPrint's default, which is what every
// résumé template gets: they declare a margin and no size.
const NAMED_SIZES: Record<string, [number, number]> = {
  a4: [210 / 25.4, 297 / 25.4],
  a3: [297 / 25.4, 420 / 25.4],
  a5: [148 / 25.4, 210 / 25.4],
  letter: [8.5, 11],
  legal: [8.5, 14],
};

export interface PageGeometry {
  /** Full page width in CSS pixels — what the canvas must be. */
  width: number;
  height: number;
  /** Print margin, applied as canvas padding since a browser will not. */
  margin: number;
  /** Height available to content on one page: the page less both margins. */
  contentHeight: number;
}

function toPx(value: string): number | null {
  const m = /^(-?[\d.]+)(in|pt|pc|mm|cm|px)?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n * (UNITS[m[2] ?? "px"] ?? 1) : null;
}

export function pageGeometry(html: string): PageGeometry {
  const rule = /@page[^{]*\{([^}]*)\}/i.exec(html)?.[1] ?? "";
  const declaration = (name: string) =>
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(rule)?.[1]?.trim() ?? null;

  const [inW, inH] = NAMED_SIZES.a4;
  let width = inW * PX_PER_IN;
  let height = inH * PX_PER_IN;

  const size = declaration("size");
  if (size) {
    const named = NAMED_SIZES[size.split(/\s+/)[0].toLowerCase()];
    if (named) {
      // "Letter landscape" swaps the axes; anything else keeps portrait.
      const landscape = /\blandscape\b/i.test(size);
      width = (landscape ? named[1] : named[0]) * PX_PER_IN;
      height = (landscape ? named[0] : named[1]) * PX_PER_IN;
    } else {
      const parts = size.split(/\s+/).map(toPx);
      if (parts[0] != null) {
        width = parts[0];
        height = parts[1] ?? parts[0];
      }
    }
  }

  const margin = toPx((declaration("margin") ?? "0").split(/\s+/)[0]) ?? 0;
  return { width, height, margin, contentHeight: height - margin * 2 };
}

/**
 * Pages a flow of `contentPx` takes at `contentHeight` per page.
 *
 * Rounded before dividing: the browser's measurement and the page height
 * disagree in the last decimal, and an unrounded ceil would invent a second
 * page for a document that ends exactly on the first.
 */
export function pageCount(contentPx: number, contentHeight: number): number {
  if (!(contentHeight > 0)) return 1;
  return Math.max(1, Math.ceil((contentPx - 1) / contentHeight));
}
