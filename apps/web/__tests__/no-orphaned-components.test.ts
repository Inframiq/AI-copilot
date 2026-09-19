import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/**
 * No component may sit in the tree with nothing rendering it.
 *
 * This is the single most expensive failure mode this codebase has had. When
 * StudioShell was deleted it silently orphaned nine components, and each
 * reached the user as its own bug report: the tailoring review vanished, then
 * the JD-paste entry, then the template picker. Every test stayed green,
 * because a component with no caller still passes its own unit tests.
 *
 * Reachability is measured from the app's real entry points only — routes and
 * middleware. Tests deliberately do not count: a component only its own test
 * imports is exactly the case above, green and dead.
 */
const ROOT = process.cwd();

/** Components kept deliberately despite having no caller. Keep it empty. */
const ALLOWED: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "node_modules" || name === ".next" ? [] : walk(path);
    }
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function resolveImport(spec: string, importer: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(importer), spec);
  else return null; // a package, not our source
  const candidates = [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")];
  return candidates.find(existsSync) ?? null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  // `from "x"` covers static imports and re-exports; `import("x")` covers the
  // lazy ones, which are how a route pulls in a heavy component.
  const specs = [
    ...[...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  return specs.map((s) => resolveImport(s, file)).filter((p): p is string => p !== null);
}

describe("component reachability", () => {
  const entries = [...walk(join(ROOT, "app")), join(ROOT, "middleware.ts")].filter(existsSync);

  const reached = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    queue.push(...importsOf(file));
  }

  it("resolves the app's imports at all", () => {
    // Guards the guard: a broken resolver would reach nothing and then call
    // every component an orphan, or reach everything and catch none.
    expect(reached.size).toBeGreaterThan(50);
  });

  it("has no component that nothing renders", () => {
    const orphans = walk(join(ROOT, "components"))
      .filter((f) => !reached.has(f))
      .map((f) => f.replace(`${ROOT}/`, ""))
      .filter((f) => !ALLOWED.includes(f));
    expect(orphans).toEqual([]);
  });
});
