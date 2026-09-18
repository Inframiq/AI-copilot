import type { ResumeContent } from "@career-copilot/types";
import type { BulletRationale } from "@/lib/api-client";
import type { BulletChange } from "@/stores/tailoring-store";

/**
 * How far a tailored bullet strays from what the résumé already claims.
 *
 * "reworded"   — the same facts in new words: every JD keyword the rewrite
 *                targeted is evidenced somewhere in the original résumé.
 * "adds_terms" — the rewrite puts a JD term into the text that the résumé
 *                never mentions. The work may support it, but it is a new
 *                claim, and the candidate has to vouch for it.
 */
export type PointKind = "reworded" | "adds_terms";

function hasTerm(text: string, term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  // Whole-term match: "Go" must not match "go-to-market" or "Google".
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9-])`, "i").test(text);
}

function resumeText(content: ResumeContent): string {
  const parts: string[] = [content.headline ?? "", content.summary ?? "", ...(content.skills ?? [])];
  for (const e of content.experience ?? []) parts.push(e.title ?? "", e.company ?? "", ...(e.bullets ?? []));
  for (const p of content.projects ?? []) parts.push(p.name ?? "", ...(p.bullets ?? []));
  return parts.join("\n");
}

/**
 * `jdTerms` — every phrase the JD is scored on (the session's matched and
 * missing lists). Checking only the keywords the rewrite said it targeted
 * missed a JD term it slipped in anyway, which then read as a mere rewording.
 */
export function classifyChange(
  change: BulletChange,
  rationale: BulletRationale | undefined,
  original: ResumeContent,
  jdTerms: string[] = [],
): { kind: PointKind; newTerms: string[] } {
  const text = resumeText(original);
  const seen = new Set<string>();
  const newTerms: string[] = [];
  for (const k of [...(rationale?.keywords ?? []), ...jdTerms]) {
    const key = k.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (hasTerm(change.tailored, k) && !hasTerm(text, k)) newTerms.push(k.trim());
  }
  return { kind: newTerms.length > 0 ? "adds_terms" : "reworded", newTerms };
}
