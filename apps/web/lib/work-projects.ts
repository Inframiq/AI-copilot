import type { ResumeContent, WorkProject } from "@career-copilot/types";
import { hasTerm } from "@/lib/terms";

/**
 * Projects inside an experience entry (ResumeContent.experience[].projects).
 */

/** The line the résumé prints for a project (apps/api/templates/
 * _job_projects.html): the client, or else its name · domain · role — only
 * the parts it has, "" when it has none. */
export function projectLine(p: WorkProject): string {
  return [p.client || p.name, p.domain, p.role].map((s) => s?.trim()).filter(Boolean).join(" · ");
}

/** The review key of a point inside a role's project — the same id the
 * tailoring pipeline gives it (apps/api/app/services/tailoring.py): role
 * `entry`, project `project`, point `bullet` → "exp2_p0_b1". */
export function projectBulletKey(entry: number, project: number, bullet: number): string {
  return `exp${entry}_p${project}_b${bullet}`;
}

/** Every point in a role, its own and its projects'. */
export function allRolePoints(role: { bullets?: string[]; projects?: WorkProject[] }): string[] {
  return [...(role.bullets ?? []), ...(role.projects ?? []).flatMap((p) => p.bullets ?? [])];
}

/**
 * How well a project fits a job description: how many of the JD's terms its
 * line, technologies and points show, plus two when the JD names its domain
 * ("Banking" in a banking JD). Judged from everything the project has, so a
 * project with no client or domain competes as fairly as one with both.
 */
export function projectFit(p: WorkProject, jdTerms: readonly string[], jdText = ""): number {
  const text = [p.client, p.name, p.domain, p.role, p.tech_stack, ...(p.bullets ?? [])].filter(Boolean).join("\n");
  const terms = jdTerms.filter((t) => hasTerm(text, t)).length;
  return terms + (p.domain?.trim() && jdText && hasTerm(jdText, p.domain) ? 2 : 0);
}

/**
 * The résumé with each role's projects ordered by how well they fit the JD,
 * best first — tailoring gives the matching client the most room. Never
 * drops one, and a tie keeps the order the candidate gave. Applied when the
 * tailored résumé is put together, after the review: reordering earlier
 * would move the points the review lists by position.
 */
export function orderProjectsForJd(content: ResumeContent, jdTerms: readonly string[], jdText = ""): ResumeContent {
  if (!content.experience?.some((e) => (e.projects?.length ?? 0) > 1)) return content;
  return {
    ...content,
    experience: content.experience.map((role) => {
      if ((role.projects?.length ?? 0) < 2) return role;
      const scored = role.projects!.map((p, at) => ({ p, at, fit: projectFit(p, jdTerms, jdText) }));
      scored.sort((a, b) => b.fit - a.fit || a.at - b.at);
      return { ...role, projects: scored.map((x) => x.p) };
    }),
  };
}
