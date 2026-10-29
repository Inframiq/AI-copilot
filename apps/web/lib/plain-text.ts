/**
 * Text as a person types it on a normal keyboard: straight quotes, plain
 * hyphens, three dots, plain bullets and arrows, ordinary spaces, nothing
 * invisible. Model-written text carries the other kind, and it reads as an
 * AI footprint on a résumé.
 *
 * The API cleans everything it saves (app/services/plain_text.py); this is
 * the same function for what the browser writes straight to the database —
 * the Profile. packages/types/plain-text-cases.json holds the cases both
 * must pass.
 */

const ODD_SPACES = "\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000";
// A run holding an odd-width space becomes one space; plain double spaces were typed.
const SPACE_RUN = new RegExp(`[ ${ODD_SPACES}]*[${ODD_SPACES}][ ${ODD_SPACES}]*`, "g");
const INVISIBLE = /[\u200b\u2060\ufeff\u00ad\u180e]/g;
// Joiners shape Indic scripts and emoji; after Latin text they do nothing.
const JOINER = /(?<![\u0370-\u{10ffff}])[\u200c\u200d]/gu;

const LONG_DASHES = "\u2014\u2015\u2e3a\u2e3b";
const LONG_DASH_BETWEEN = new RegExp(`(?<=\\S)[ \\t]*[${LONG_DASHES}][ \\t]*(?=\\S)`, "g");
const LONG_DASH = new RegExp(`[${LONG_DASHES}]`, "g");

const BULLETS =
  "\u2022\u2023\u2043\u2219\u00b7\u25e6\u25cf\u25cb\u25a0\u25a1\u25aa\u25ab\u25c6\u25c7" +
  "\u2666\u25ba\u25b6\u25b8\u25b9\u27a2\u27a3\u27a4\u2713\u2714\u2756\u2605\u2606" +
  "\u29bf\u26ab\u26ac\u25c9\u25d8";
const ARROWS: Record<string, string> = {
  "->": "\u2192\u27f6\u2794\u279c\u279d\u279e\u2799\u279b\u21e8\u21fe",
  "<-": "\u2190\u27f5\u21e6",
  "<->": "\u2194\u27f7",
  "=>": "\u21d2\u27f9",
  "<=": "\u21d0",
  "<=>": "\u21d4",
};

const SINGLE = new Map<string, string>();
for (const c of "\u201c\u201d\u201e\u201f") SINGLE.set(c, '"');
for (const c of "\u2018\u2019\u201a\u201b") SINGLE.set(c, "'");
for (const c of "\u2010\u2011\u2012\u2013\u2212") SINGLE.set(c, "-");
SINGLE.set("\u2026", "...");
for (const c of BULLETS) SINGLE.set(c, "-");
for (const [plain, chars] of Object.entries(ARROWS)) for (const c of chars) SINGLE.set(c, plain);
const SINGLE_RE = new RegExp(`[${[...SINGLE.keys()].join("")}]`, "g");

// Formatted text is stored as HTML, where a non-breaking space is written
// &nbsp;. These entities are read as their characters; any other (&amp;,
// &lt;, &eacute;) is left as written. Same list as the API's _NAMED.
const NAMED: Record<string, string> = {
  nbsp: "\u00a0", ensp: "\u2002", emsp: "\u2003", emsp13: "\u2004",
  emsp14: "\u2005", numsp: "\u2007", puncsp: "\u2008", thinsp: "\u2009",
  hairsp: "\u200a", MediumSpace: "\u205f", NoBreak: "\u2060",
  ZeroWidthSpace: "\u200b", zwj: "\u200d", zwnj: "\u200c", shy: "\u00ad",
  mdash: "\u2014", ndash: "\u2013", horbar: "\u2015", hyphen: "\u2010",
  dash: "\u2010", minus: "\u2212", hellip: "\u2026", mldr: "\u2026",
  lsquo: "\u2018", rsquo: "\u2019", rsquor: "\u2019", sbquo: "\u201a",
  ldquo: "\u201c", rdquo: "\u201d", rdquor: "\u201d", bdquo: "\u201e",
  bull: "\u2022", bullet: "\u2022", middot: "\u00b7", centerdot: "\u00b7",
  rarr: "\u2192", larr: "\u2190", harr: "\u2194", rArr: "\u21d2",
  lArr: "\u21d0", hArr: "\u21d4", check: "\u2713",
};
const ENTITY = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]*);/g;

function entityChar(whole: string, ref: string): string {
  let char = "";
  if (ref[0] === "#") {
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    char = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  } else {
    char = Object.hasOwn(NAMED, ref) ? NAMED[ref] : "";
  }
  return char && plain(char) !== char ? char : whole;
}

/** The same text, typed on a normal keyboard. */
export function plainText(text: string): string {
  if (!text) return text;
  return plain(text.replace(ENTITY, entityChar));
}

function plain(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(JOINER, "")
    .replace(SPACE_RUN, " ")
    .replace(LONG_DASH_BETWEEN, " - ")
    .replace(LONG_DASH, "-")
    .replace(SINGLE_RE, (c) => SINGLE.get(c)!);
}

/** plainText over every string inside an object or array; keys and
 *  non-text values are left alone. */
export function plainDeep<T>(value: T): T {
  if (typeof value === "string") return plainText(value) as T;
  if (Array.isArray(value)) return value.map(plainDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plainDeep(v)]),
    ) as T;
  }
  return value;
}
