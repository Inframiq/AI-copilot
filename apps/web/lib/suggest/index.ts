/**
 * Search-as-you-type suggestions from lists kept in the app — no model, no
 * credits, no request beyond loading a list once. Picking a suggestion
 * keeps names the same for everyone ("JavaScript", never "JS" or
 * "javascript"), which is what lets a skill match a job description.
 *
 * The lists live in ./data: skills, job titles, degrees, languages and
 * certifications are kept by hand; cities (GeoNames) and colleges (India's
 * AISHE directory and Hipo's worldwide university list) are built from
 * public datasets by
 * scripts/build-suggestion-lists.py. Each loads the first time a field of
 * its kind is used, then stays in memory.
 */

export type SuggestKind = "skill" | "jobTitle" | "degree" | "college" | "language" | "certification" | "city" | "domain";

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
  domain: () => import("./data/domains.json").then((m) => m.default as Stored),
};

/** Shown under a list's suggestions where its source asks for credit. */
export const SUGGEST_CREDIT: Partial<Record<SuggestKind, string>> = {
  city: "Place names: GeoNames (CC BY 4.0)",
  college: "Indian institutions: AISHE, Ministry of Education (Open Government Data License – India)",
};

interface Entry {
  name: string;
  /** The name and its aliases, folded (see fold). The name is first. */
  keys: string[];
  /** The same without spaces, for "nodejs" typed for "node js" — made the
   * first time a query needs it. */
  compact?: string[];
}

export interface SuggestIndex {
  entries: Entry[];
  /** Entries with a word (in the name or an alias) starting with these one
   * or two characters. Two keep the pool a query scans small: "gi" looks
   * at a few hundred colleges, not every one with a word starting "g". */
  byPrefix: Map<string, number[]>;
  /** A folded name or alias → the one name it stands for; null when more
   * than one name uses it ("pm": Product or Project Manager). */
  exact: Map<string, string | null>;
}

const NOT_PLAIN = /[^a-z0-9 ]/;

/** Lowercase, accents off, spacing and punctuation runs to one space —
 * "Node.js", "node js" and "NODE-JS" all fold to "node js". Keeps + and #
 * ("C++", "C#"). */
export function fold(text: string): string {
  const lower = text.toLowerCase();
  // Most names are plain letters, digits and single spaces: nothing to do.
  if (!NOT_PLAIN.test(lower) && !lower.includes("  ") && lower.trim() === lower) return lower;
  return lower
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim();
}

function emptyIndex(): SuggestIndex {
  return { entries: [], byPrefix: new Map(), exact: new Map() };
}

/** Adds names[from, to) to the index. */
function addNames(index: SuggestIndex, names: Array<string | string[]>, from: number, to: number) {
  const { entries, byPrefix, exact } = index;
  const file = (prefix: string, at: number) => {
    const bucket = byPrefix.get(prefix);
    if (!bucket) byPrefix.set(prefix, [at]);
    else if (bucket[bucket.length - 1] !== at) bucket.push(at);
  };
  for (let n = from; n < to; n++) {
    const item = names[n];
    let name: string;
    let keys: string[];
    if (typeof item === "string") {
      // Nearly every name has no aliases: no set or arrays to build.
      name = item;
      const k = fold(item);
      keys = k ? [k] : [];
    } else {
      name = item[0];
      keys = [...new Set(item.map(fold).filter(Boolean))];
    }
    const at = entries.push({ name, keys }) - 1;
    for (const k of keys) {
      for (const word of k.split(" ")) {
        file(word[0], at);
        if (word.length > 1) file(word.slice(0, 2), at);
      }
      exact.set(k, exact.has(k) && exact.get(k) !== name ? null : name);
    }
  }
}

export function buildIndex(names: Array<string | string[]>): SuggestIndex {
  const index = emptyIndex();
  addNames(index, names, 0, names.length);
  return index;
}

/** Names indexed between handing the page back, so building the college
 * list (64,000 names) never freezes it: each slice is a few milliseconds. */
const SLICE = 3000;

async function buildIndexInSlices(names: Array<string | string[]>): Promise<SuggestIndex> {
  const index = emptyIndex();
  for (let from = 0; from < names.length; from += SLICE) {
    addNames(index, names, from, Math.min(from + SLICE, names.length));
    if (from + SLICE < names.length) await new Promise((r) => setTimeout(r, 0));
  }
  return index;
}

const indexes = new Map<SuggestKind, Promise<SuggestIndex>>();

/** The kind's list, indexed — loaded once, shared by every field. */
export function loadSuggestions(kind: SuggestKind): Promise<SuggestIndex> {
  let pending = indexes.get(kind);
  if (!pending) {
    pending = LOADERS[kind]().then((s) => buildIndexInSlices(s.names));
    // A failed load (offline) is tried again next time, not remembered.
    pending.catch(() => indexes.delete(kind));
    indexes.set(kind, pending);
  }
  return pending;
}

/**
 * Up to `limit` names for what's typed: the name or an alias exactly, then
 * names starting with it, then a later word starting with it, each in the
 * list's own order (most used, or largest city, first).
 */
export function suggest(index: SuggestIndex, typed: string, limit = 8): string[] {
  const q = fold(typed);
  if (!q) return [];
  const pool = index.byPrefix.get(q.length > 1 && q[1] !== " " ? q.slice(0, 2) : q[0]) ?? [];
  const word = ` ${q}`;
  const qCompact = q.replace(/ /g, "");
  const found: Array<{ name: string; score: number; at: number }> = [];
  for (const at of pool) {
    const entry = index.entries[at];
    const { name, keys } = entry;
    let best = -1;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      // Exact, then starts with it, then a later word does, then (typed
      // without its space or dot) the whole thing does.
      const r = k === q ? 0 : k.startsWith(q) ? 1 : k.includes(word) ? 2
        : q.length >= 3 && (entry.compact ??= keys.map((key) => key.replace(/ /g, "")))[i].startsWith(qCompact) ? 3 : -1;
      // A match on the name itself beats the same match on an alias.
      if (r >= 0) {
        const s = r * 2 + (i === 0 ? 0 : 1);
        if (best < 0 || s < best) best = s;
      }
    }
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
