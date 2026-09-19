import type { ResumeContent } from "@career-copilot/types";

/**
 * Two things résumé checkers flag that the ATS score does not measure:
 * overused wording, and accomplishments with no number behind them.
 *
 * Both read the résumé as the user's current picks would produce it, so they
 * move as points are switched on and off. Pure and cheap — no model call.
 */

export interface ResumeBullet {
  /** Review key, same as the pipeline's bullet id: "exp0_b2", "proj1_b0". */
  key: string;
  text: string;
  /** "Title · Company" or the project name, to say where the bullet is. */
  where: string;
}

export function listBullets(content: ResumeContent | null): ResumeBullet[] {
  if (!content) return [];
  const out: ResumeBullet[] = [];
  (content.experience ?? []).forEach((e, i) =>
    (e.bullets ?? []).forEach((text, j) =>
      out.push({ key: `exp${i}_b${j}`, text, where: [e.title, e.company].filter(Boolean).join(" · ") }),
    ),
  );
  (content.projects ?? []).forEach((p, i) =>
    (p.bullets ?? []).forEach((text, j) => out.push({ key: `proj${i}_b${j}`, text, where: p.name ?? "" })),
  );
  return out.filter((b) => b.text.trim());
}

/** A word or phrase used in this many bullets or more reads as overused. */
export const REPEAT_THRESHOLD = 3;

// Words that carry no meaning of their own, so a phrase made only of them
// ("of the", "with a") is never reported.
const STOPWORDS = new Set(
  `a an the and or of to in on for with by at from into over across per via as
   its their our my this that these those was were is are be been using used
   all each every both more most other new`.split(/\s+/),
);

function words(text: string): string[] {
  // Inner punctuation stays ("node.js", "c++", "ci/cd"); a trailing full stop
  // or comma does not, or "development." and "development" count apart.
  return (text.toLowerCase().match(/[a-z][a-z'+#./-]*/g) ?? []).map((w) => w.replace(/[.,/'-]+$/, ""));
}

export interface Repeated {
  text: string;
  /** How many bullets use it. */
  count: number;
}

/**
 * Opening verbs and two-word phrases that appear in REPEAT_THRESHOLD or more
 * bullets. Counted per bullet, not per occurrence: one bullet that says
 * "component library" twice is a different problem from three that each do.
 */
export function findRepetition(bullets: ResumeBullet[]): { verbs: Repeated[]; phrases: Repeated[] } {
  const verbCounts = new Map<string, number>();
  const phraseCounts = new Map<string, number>();

  for (const b of bullets) {
    const ws = words(b.text);
    if (ws[0]) verbCounts.set(ws[0], (verbCounts.get(ws[0]) ?? 0) + 1);
    const seen = new Set<string>();
    for (let i = 0; i + 1 < ws.length; i += 1) {
      const [x, y] = [ws[i], ws[i + 1]];
      if (STOPWORDS.has(x) || STOPWORDS.has(y) || x.length < 3 || y.length < 3) continue;
      // The opening verb is reported on its own; don't report it again as
      // the start of a phrase.
      if (i === 0) continue;
      seen.add(`${x} ${y}`);
    }
    for (const p of seen) phraseCounts.set(p, (phraseCounts.get(p) ?? 0) + 1);
  }

  const over = (m: Map<string, number>) =>
    [...m.entries()]
      .filter(([, n]) => n >= REPEAT_THRESHOLD)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([text, count]) => ({ text, count }));

  return { verbs: over(verbCounts), phrases: over(phraseCounts).slice(0, 6) };
}

export interface NumberGap extends ResumeBullet {
  /** The question asking the user for this bullet's number. */
  question: string;
}

/** Bullets that still carry no number and have a question for the user. */
export function numberGaps(bullets: ResumeBullet[], prompts: Record<string, string>): NumberGap[] {
  return bullets
    .filter((b) => prompts[b.key] && !/\d/.test(b.text))
    .map((b) => ({ ...b, question: prompts[b.key] }));
}

/** Share of bullets carrying at least one number, 0..1. */
export function quantifiedShare(bullets: ResumeBullet[]): number {
  if (bullets.length === 0) return 0;
  return bullets.filter((b) => /\d/.test(b.text)).length / bullets.length;
}
