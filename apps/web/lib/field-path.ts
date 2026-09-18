import type { ResumeContent } from "@career-copilot/types";

/**
 * Dot paths from the rendered document back to the résumé model.
 *
 * The templates carry `data-field="experience.0.bullets.2"` on editable text;
 * these turn that string into a read, or an immutable write.
 *
 * A path that no longer resolves — a stale attribute from an earlier render,
 * or a key the model never had — is ignored rather than created. An edit can
 * therefore never invent structure or corrupt the résumé, which matters
 * because the attribute comes from a document the user has been typing into.
 */
type Node = Record<string, unknown> | unknown[];

function segments(path: string): string[] {
  return path.split(".").filter(Boolean);
}

function get(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    const i = Number(key);
    return Number.isInteger(i) ? node[i] : undefined;
  }
  if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
  return undefined;
}

export function readField(content: ResumeContent, path: string): string | undefined {
  const keys = segments(path);
  if (keys.length === 0) return undefined;
  let node: unknown = content;
  for (const key of keys) {
    node = get(node, key);
    if (node === undefined || node === null) return undefined;
  }
  return typeof node === "string" ? node : undefined;
}

export function writeField(
  content: ResumeContent,
  path: string,
  value: string | string[],
): ResumeContent {
  const keys = segments(path);
  if (keys.length === 0) return content;

  // Probe the whole path before copying anything, so a stale attribute costs
  // nothing and returns the original object identity.
  let probe: unknown = content;
  for (const key of keys.slice(0, -1)) {
    probe = get(probe, key);
    if (probe === undefined || probe === null) return content;
  }
  const last = keys[keys.length - 1];
  if (get(probe, last) === undefined) return content;

  const clone = (node: Node): Node => (Array.isArray(node) ? [...node] : { ...node });

  const root = clone(content as unknown as Node);
  let cursor: Node = root;
  for (const key of keys.slice(0, -1)) {
    const next = clone(get(cursor, key) as Node);
    (cursor as Record<string, unknown>)[key] = next;
    cursor = next;
  }
  (cursor as Record<string, unknown>)[last] = value;
  return root as unknown as ResumeContent;
}
