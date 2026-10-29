import { fold } from "@/lib/suggest";

/**
 * Repeats in fields that are lists of things — skills, a tech stack,
 * languages, certifications, Awards and the other one-per-line sections.
 * Two entries are the same when they fold the same (lib/suggest's fold):
 * case, accents, spacing and punctuation aside — "node js" is "Node.js".
 * Skills also count an alias as its name ("JS" is "JavaScript"); see
 * findRepeat in lib/suggest/client.
 */

/** Indexes of the entries that repeat an earlier one. Blanks never do. */
export function repeatedAt(values: readonly string[]): Set<number> {
  const seen = new Set<string>();
  const out = new Set<number>();
  values.forEach((v, i) => {
    const key = fold(v ?? "");
    if (!key) return;
    if (seen.has(key)) out.add(i);
    else seen.add(key);
  });
  return out;
}

/** The entries with each repeat after the first left out. */
export function withoutRepeats<T>(values: readonly T[], text: (v: T) => string = (v) => String(v)): T[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = fold(text(v) ?? "");
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether `value` is already among `existing`. */
export function isListed(value: string, existing: readonly string[]): boolean {
  const key = fold(value);
  return !!key && existing.some((e) => fold(e) === key);
}
