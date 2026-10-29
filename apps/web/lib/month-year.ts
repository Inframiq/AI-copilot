/**
 * Dates on a résumé — when a role or project started and ended — as one
 * standard text: "Jan 2022", or "2022" when only the year is known, or
 * "Present". Durations (career-profile-client) and the PDF templates read
 * that form; the month-year picker writes it.
 *
 * Dates typed before the picker ("January 2022", "06/2021", "2021-06") are
 * read here and given back in the standard form, so they convert the next
 * time the field is edited.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const PRESENT = "Present";

/** A date: a year, and a month 0–11 when one is known. */
export interface MonthYear {
  year: number;
  month: number | null;
}

const NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return null;
  // "Sept" is common; "Jun", "June" and "January" all read as theirs.
  const at = NAMES.findIndex((n) => n.startsWith(w) || (w === "sept" && n === "september"));
  return at >= 0 ? at : null;
}

/** "22" → 2022, "98" → 1998: two-digit years up to ten years ahead. */
function yearOf(text: string): number | null {
  if (/^\d{4}$/.test(text)) return Number(text);
  if (/^\d{2}$/.test(text)) {
    const n = Number(text);
    const cutoff = (new Date().getFullYear() + 10) % 100;
    return n <= cutoff ? 2000 + n : 1900 + n;
  }
  return null;
}

const PRESENT_WORDS = /^(present|current(ly)?|now|ongoing|till date|to date|today)$/i;

/** True for "Present", "Current", "Now", "Till date"… */
export function isPresent(raw: string | null | undefined): boolean {
  return PRESENT_WORDS.test((raw ?? "").trim());
}

/**
 * The date a piece of text means, or null when it isn't one. Reads
 * "Jan 2022", "January 2022", "Sept. 2021", "Jan '22", "01/2022",
 * "1-2022", "2022-01", "2022/01" and a bare "2022".
 */
export function parseMonthYear(raw: string | null | undefined): MonthYear | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  let m = /^([A-Za-z]{3,9}\.?),? '?(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = monthOf(m[1]);
    const year = yearOf(m[2]);
    return month !== null && year !== null ? { year, month } : null;
  }
  m = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { year: Number(m[2]), month: Number(m[1]) - 1 };
  m = /^(\d{4})\s*[/.-]\s*(\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[1]), month: Number(m[2]) - 1 };
  if (/^\d{4}$/.test(s)) return { year: Number(s), month: null };
  return null;
}

/** "Jan 2022", or "2022" with no month. */
export function formatMonthYear(d: MonthYear): string {
  return d.month === null ? String(d.year) : `${MONTHS[d.month]} ${d.year}`;
}

/**
 * The standard form of a typed date: "Jan 2022", "2022", "Present", or ""
 * for nothing. A date it can't read is given back unchanged, for the picker
 * to show as needing one picked.
 */
export function tidyDate(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (isPresent(s)) return PRESENT;
  const d = parseMonthYear(s);
  return d ? formatMonthYear(d) : s;
}

/** Whether the text is empty, "Present", or a date in the standard form. */
export function isStandardDate(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  return s === "" || s === PRESENT || (tidyDate(s) === s && parseMonthYear(s) !== null);
}

/** Months since year 0 — a year alone counts from its January when it
 * starts something and from its December when it ends something, so
 * "2022" to "Mar 2022" is fine and so is "Jun 2022" to "2022". */
function ordinal(d: MonthYear, as: "start" | "end"): number {
  return d.year * 12 + (d.month ?? (as === "start" ? 0 : 11));
}

/** True when `end` is a date before `start`. "Present", blanks and text
 * that isn't a date never are. */
export function endsBeforeStart(start: string | null | undefined, end: string | null | undefined): boolean {
  if (isPresent(end)) return false;
  const a = parseMonthYear(start);
  const b = parseMonthYear(end);
  return !!a && !!b && ordinal(b, "end") < ordinal(a, "start");
}

/** True when a date in `year`/`month` would end before `start`. */
export function monthBefore(start: string | null | undefined, year: number, month: number | null): boolean {
  const a = parseMonthYear(start);
  return !!a && ordinal({ year, month }, "end") < ordinal(a, "start");
}
