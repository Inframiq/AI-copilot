/** Whole-term match: "Go" must not match "go-to-market" or "Google". Shared
 * by the review's point classifier and the project ordering. */
export function hasTerm(text: string, term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9-])`, "i").test(text);
}
