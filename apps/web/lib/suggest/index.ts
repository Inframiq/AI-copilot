/**
 * Search-as-you-type suggestions from lists kept in the app — no model, no
 * credits, no request beyond loading a list once. Picking a suggestion
 * keeps names the same for everyone ("JavaScript", never "JS" or
 * "javascript"), which is what lets a skill match a job description.
 *
 * The lists live in ./data: skills, job titles, degrees, languages and
 * certifications are kept by hand; cities (GeoNames) and colleges (Hipo's
 * university list) are built from public datasets by
 * scripts/build-suggestion-lists.py. Each loads the first time a field of
 * its kind is used, then stays in memory.
 */

export type SuggestKind = "skill" | "jobTitle" | "degree" | "college" | "language" | "certification" | "city";

/** A list as stored: a name, or [name, ...aliases] typed for it. */
type Stored = { source: string; license?: string; names: Array<string | string[]> };

const LOADERS: Record<SuggestKind, () => Promise<Stored>> = {
  skill: () => import("./data/skills.json").then((m) => m.default as Stored),
  jobTitle: () => import("./data/job-titles.json").then((m) => m.default as Stored),
  degree: () => import("./data/degrees.json").then((m) => m.default as Stored),
  language: () => import("./data/languages.json").then((m) => m.default as Stored),
  certification: () => import("./data/certifications.json").then((m) => m.default as Stored),
  college: () => import("./data/colleges.json").then((m) => m.default as Stored),
  city: () => import("./data/cities.json").then((m) => m.default as Stored),
};

/** Shown under a list's suggestions where its source asks for credit. */
export const SUGGEST_CREDIT: Partial<Record<SuggestKind, string>> = {
  city: "Place names: GeoNames (CC BY 4.0)",
};

interface Entry {
  name: string;
  /** The name and its aliases, folded (see fold). The name is first. */
  keys: string[];
}

export interface SuggestIndex {
  entries: Entry[];
  /** Entries whose name or alias has a word starting with this character. */
  byFirst: Map<string, number[]>;
  /** A folded name or alias → the one name it stands for; null when more
   * than one name uses it ("pm": Product or Project Manager). */
  exact: Map<string, string | null>;
}

/** Lowercase, accents off, spacing and punctuation runs to one space —
 * "Node.js", "node js" and "NODE-JS" all fold to "node js". Keeps + and #
 * ("C++", "C#"). */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim();
}

export function buildIndex(names: Array<string | string[]>): SuggestIndex {
  const entries: Entry[] = [];
  const byFirst = new Map<string, number[]>();
  const exact = new Map<string, string | null>();
  for (const item of names) {
    const [name, ...aliases] = typeof item === "string" ? [item] : item;
    const keys = [...new Set([name, ...aliases].map(fold).filter(Boolean))];
    const at = entries.push({ name, keys }) - 1;
    const firsts = new Set(keys.flatMap((k) => k.split(" ").map((w) => w[0])));
    for (const c of firsts) {
      const bucket = byFirst.get(c);
      if (bucket) bucket.push(at);
      else byFirst.set(c, [at]);
    }
    for (const k of keys) exact.set(k, exact.has(k) && exact.get(k) !== name ? null : name);
  }
  return { entries, byFirst, exact };
}

const indexes = new Map<SuggestKind, Promise<SuggestIndex>>();

/** The kind's list, indexed — loaded once, shared by every field. */
export function loadSuggestions(kind: SuggestKind): Promise<SuggestIndex> {
  let pending = indexes.get(kind);
  if (!pending) {
    pending = LOADERS[kind]().then((s) => buildIndex(s.names));
    // A failed load (offline) is tried again next time, not remembered.
    pending.catch(() => indexes.delete(kind));
    indexes.set(kind, pending);
  }
  return pending;
}

/** How well `key` answers `q`, lower is better; -1 for not at all. */
function rank(key: string, q: string): number {
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (key.includes(` ${q}`)) return 2;
  // Typed without the space or dot: "nodejs" for "node js".
  if (q.length >= 3 && key.replace(/ /g, "").startsWith(q.replace(/ /g, ""))) return 3;
  return -1;
}

/**
 * Up to `limit` names for what's typed: the name or an alias exactly, then
 * names starting with it, then a later word starting with it, each in the
 * list's own order (most used, or largest city, first).
 */
export function suggest(index: SuggestIndex, typed: string, limit = 8): string[] {
  const q = fold(typed);
  if (!q) return [];
  const pool = index.byFirst.get(q[0]) ?? [];
  const found: Array<{ name: string; score: number; at: number }> = [];
  for (const at of pool) {
    const { name, keys } = index.entries[at];
    let best = -1;
    keys.forEach((k, i) => {
      const r = rank(k, q);
      // A match on the name itself beats the same match on an alias.
      if (r >= 0) {
        const s = r * 2 + (i === 0 ? 0 : 1);
        if (best < 0 || s < best) best = s;
      }
    });
    if (best >= 0) found.push({ name, score: best, at });
  }
  found.sort((a, b) => a.score - b.score || a.at - b.at);
  return found.slice(0, limit).map((f) => f.name);
}

/** The list's name for exactly what's typed — "js" → "JavaScript",
 * "javascript" → "JavaScript" — or null when it isn't one, or when the
 * text stands for more than one name. */
export function canonicalName(index: SuggestIndex, typed: string): string | null {
  return index.exact.get(fold(typed)) ?? null;
}
