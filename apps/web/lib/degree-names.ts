/**
 * A degree written as its short form, in full — "B.Tech in CSE" →
 * "Bachelor of Technology (B.Tech) in CSE".
 *
 * The user's research (2026-11-23): Indian résumés should write degrees in
 * full; recruiters and some systems miss the short forms. The short form
 * stays in brackets, the way the degree suggestions print it, so a search
 * for either finds it. Nothing is rewritten on its own: the Profile and
 * Builder offer it beside the Degree field (DegreeFullName).
 *
 * apps/api/app/services/degree_names.py is the same rule (the ATS check
 * names a short form with it); packages/types/degree-name-cases.json holds
 * the cases both pass.
 */

// [letters of the short form, the full name, strict]. Strict forms are
// also English words or two letters (BE, MA, March, Med…): they count only
// in capitals or with a dot, so "March 2020" or "Me" is never a degree.
const DEGREES: [string[], string, boolean][] = [
  [["b", "tech"], "Bachelor of Technology (B.Tech)", false],
  [["m", "tech"], "Master of Technology (M.Tech)", false],
  [["b", "e"], "Bachelor of Engineering (B.E.)", true],
  [["m", "e"], "Master of Engineering (M.E.)", true],
  [["b", "sc"], "Bachelor of Science (B.Sc.)", false],
  [["m", "sc"], "Master of Science (M.Sc.)", false],
  [["b", "s"], "Bachelor of Science (B.S.)", true],
  [["m", "s"], "Master of Science (M.S.)", true],
  [["b", "a"], "Bachelor of Arts (B.A.)", true],
  [["m", "a"], "Master of Arts (M.A.)", true],
  [["b", "com"], "Bachelor of Commerce (B.Com)", false],
  [["m", "com"], "Master of Commerce (M.Com)", false],
  [["b", "c", "a"], "Bachelor of Computer Applications (BCA)", false],
  [["m", "c", "a"], "Master of Computer Applications (MCA)", false],
  [["b", "b", "a"], "Bachelor of Business Administration (BBA)", false],
  [["m", "b", "a"], "Master of Business Administration (MBA)", false],
  [["p", "g", "d", "m"], "Post Graduate Diploma in Management (PGDM)", false],
  [["b", "arch"], "Bachelor of Architecture (B.Arch)", false],
  [["m", "arch"], "Master of Architecture (M.Arch)", true],
  [["b", "des"], "Bachelor of Design (B.Des)", false],
  [["m", "des"], "Master of Design (M.Des)", false],
  [["b", "pharm"], "Bachelor of Pharmacy (B.Pharm)", false],
  [["m", "pharm"], "Master of Pharmacy (M.Pharm)", false],
  [["m", "b", "b", "s"], "Bachelor of Medicine, Bachelor of Surgery (MBBS)", false],
  [["b", "d", "s"], "Bachelor of Dental Surgery (BDS)", false],
  [["l", "l", "b"], "Bachelor of Laws (LL.B.)", false],
  [["l", "l", "m"], "Master of Laws (LL.M.)", false],
  [["b", "ed"], "Bachelor of Education (B.Ed)", true],
  [["m", "ed"], "Master of Education (M.Ed)", true],
  [["ph", "d"], "Doctor of Philosophy (Ph.D.)", false],
  [["m", "phil"], "Master of Philosophy (M.Phil)", false],
  [["b", "f", "a"], "Bachelor of Fine Arts (BFA)", false],
  [["m", "f", "a"], "Master of Fine Arts (MFA)", false],
  [["b", "h", "m"], "Bachelor of Hotel Management (BHM)", false],
  [["b", "s", "w"], "Bachelor of Social Work (BSW)", false],
  [["m", "s", "w"], "Master of Social Work (MSW)", false],
  [["b", "p", "t"], "Bachelor of Physiotherapy (BPT)", false],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest short form first, so "BSc" is not read as "BS".
const PATTERNS = [...DEGREES]
  .sort((a, b) => b[0].join("").length - a[0].join("").length)
  .map(([parts, full, strict]) => ({
    re: new RegExp(`^\\s*(${parts.map(escape).join("\\.?\\s?")}\\.?)(?=$|[\\s,(:;/–—-])`, "i"),
    full,
    strict,
  }));

// What may follow the short form without an "in" between.
const NO_IN = /^(?:[,(:;/–—-]|(?:in|of|with|and|hons?|honou?rs|honors)\b)/i;
const BRACKETED = /^\((.+)\)$/;
const HONOURS = /^\s*(?:hons?|honou?rs|honors)\.?\s*$/i;

/** The degree with its short form written in full, or null when it
 * doesn't open with one (already in full, or not a degree). */
export function fullDegreeName(degree: string | null | undefined): string | null {
  const text = (degree ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (!text) return null;
  for (const { re, full, strict } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const short = m[1];
    if (strict && !short.includes(".") && short.replace(/ /g, "") !== short.replace(/ /g, "").toUpperCase()) continue;
    let rest = text.slice(m[0].length).trim();
    if (!rest) return full;
    if (rest.toLowerCase().startsWith(full.split(" ")[0].toLowerCase())) return null;
    const bracketed = BRACKETED.exec(rest);
    if (bracketed && !HONOURS.test(bracketed[1])) rest = bracketed[1].trim();
    if (",:;/".includes(rest[0])) return `${full}${rest}`;
    return NO_IN.test(rest) ? `${full} ${rest}` : `${full} in ${rest}`;
  }
  return null;
}
