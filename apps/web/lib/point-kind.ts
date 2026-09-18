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

export function classifyChange(
  change: BulletChange,
  rationale: BulletRationale | undefined,
  original: ResumeContent,
): { kind: PointKind; newTerms: string[] } {
  const text = resumeText(original);
  const newTerms = (rationale?.keywords ?? []).filter(
    (k) => k.trim() && hasTerm(change.tailored, k) && !hasTerm(text, k),
  );
  return { kind: newTerms.length > 0 ? "adds_terms" : "reworded", newTerms };
}
