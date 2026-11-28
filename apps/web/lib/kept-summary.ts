/**
 * Summaries past the 100-word standard that the user chose to keep as they
 * are ("Save my version"). The Profile's Save and the Builder's autosave
 * refuse a summary past the standard (summaryCapError) unless it is one of
 * these, so the choice is asked once per version, not on every save after.
 * Edited, it is a new version and is asked about again.
 *
 * Kept by its exact words, in this browser (a convenience, like a dismissed
 * hint): on another device the user is asked once more.
 */
const KEY = "kripax.kept-summaries";
const MAX = 10;

const tidy = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function isKeptSummary(text: string | null | undefined): boolean {
  const t = tidy(text);
  return !!t && read().includes(t);
}

export function keepSummary(text: string | null | undefined): void {
  const t = tidy(text);
  if (!t) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([t, ...read().filter((x) => x !== t)].slice(0, MAX)));
  } catch {
    /* asked again next time */
  }
}

/** Same version of the summary: spacing aside. */
export const sameSummary = (a: string | null | undefined, b: string | null | undefined) => tidy(a) === tidy(b);
