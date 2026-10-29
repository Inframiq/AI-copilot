import type { WorkProject } from "@career-copilot/types";

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
