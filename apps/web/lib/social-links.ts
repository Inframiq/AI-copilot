/**
 * LinkedIn and GitHub profile links: what counts as one, and the one form
 * they're saved in — `linkedin.com/in/<name>` and `github.com/<username>`,
 * which is also how a résumé prints them (the link itself gets https://).
 *
 * Structure only: LinkedIn refuses automated lookups, so whether the
 * profile exists can't be checked. The database refuses a new link that
 * isn't in the standard form (migration 054); packages/types/
 * social-link-cases.json holds the examples both sides are tested against.
 */

export type SocialField = "linkedin" | "github";

export const SOCIAL_HINT: Record<SocialField, string> = {
  linkedin: "Use your profile link: linkedin.com/in/your-name",
  github: "Use your profile link: github.com/your-username",
};

// LinkedIn's own rule for a custom URL is 3–100 letters or numbers;
// generated ones add hyphens, and names in other scripts arrive
// percent-encoded.
const LINKEDIN_NAME = /^[\p{L}\p{N}-]{3,100}$/u;
// GitHub's: up to 39 letters, digits or single hyphens, not at either end.
const GITHUB_NAME = /^(?=.{1,39}$)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

function parse(raw: string): URL | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  // A scheme other than http(s) is refused rather than given a second one.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

/** The path's parts, decoded, ignoring one trailing slash. */
function segments(url: URL): string[] | null {
  try {
    return url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
}

/**
 * The standard form of a profile link, "" for an empty field, or null when
 * the text isn't a profile link at all.
 */
export function tidySocialLink(field: SocialField, raw: string | null | undefined): string | null {
  if (!(raw ?? "").trim()) return "";
  const url = parse(raw!);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const parts = segments(url);
  if (!parts) return null;
  if (field === "linkedin") {
    // linkedin.com, www., m., and the country ones (in., uk.).
    if (!/^(?:(?:www|m|[a-z]{2})\.)?linkedin\.com$/.test(host)) return null;
    if (parts.length !== 2 || parts[0] !== "in" || !LINKEDIN_NAME.test(parts[1])) return null;
    return `linkedin.com/in/${parts[1]}`;
  }
  if (!/^(?:www\.)?github\.com$/.test(host)) return null;
  if (parts.length !== 1 || !GITHUB_NAME.test(parts[0])) return null;
  return `github.com/${parts[0]}`;
}

/** True when the field is empty or holds a profile link. */
export function isSocialLinkOk(field: SocialField, raw: string | null | undefined): boolean {
  return tidySocialLink(field, raw) !== null;
}

/**
 * Contact details with each profile link in its standard form — and, with
 * `dropBad`, a link that isn't one left out. For saves that aren't editing
 * the links (onboarding's upload, a first profile made from a résumé's
 * contact): the database would refuse the whole save over one. The résumé
 * keeps the link as it was, flagged in the Builder.
 */
export function tidyContactLinks<T extends { linkedin?: string; github?: string }>(
  contact: T,
  { dropBad = false }: { dropBad?: boolean } = {},
): T {
  const out = { ...contact };
  for (const field of ["linkedin", "github"] as const) {
    if (out[field] === undefined) continue;
    const tidy = tidySocialLink(field, out[field]);
    if (tidy !== null) out[field] = tidy;
    else if (dropBad) out[field] = "";
  }
  return out;
}
