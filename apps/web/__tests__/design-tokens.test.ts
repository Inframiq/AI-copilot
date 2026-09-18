import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A Tailwind utility naming a token that does not exist emits no CSS at all
 * — silently. `py-3xl` and `text-caution` both shipped in this project
 * looking styled in review and rendering unstyled in the browser, and a
 * component test asserting on a testid cannot see the difference.
 *
 * Scoped to the named spacing scale: those names are a closed set, so this
 * catches the whole class with no false positives. Colour utilities are not
 * covered — they collide with Tailwind's own built-ins (`text-center`,
 * `bg-white`) and cannot be told apart by name alone.
 */
const ROOTS = ["components/builder", "components/studio", "app/(builder)"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

const SPACING = new Set(
  [...readFileSync("app/globals.css", "utf8").matchAll(/--spacing-([a-z0-9]+)\s*:/g)].map(
    (m) => m[1],
  ),
);

// The suffix must be allowed to start with a digit — `3xl` is exactly the
// shape that shipped broken. Purely numeric values are filtered after the
// match instead, since the numeric scale is derived and always valid.
const UTILITY =
  /(?:^|[\s"'`:])(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-([a-z0-9][a-z0-9.]*)(?=[\s"'`]|$)/g;

describe("design tokens", () => {
  it("has a named spacing scale to check against", () => {
    expect(SPACING.size).toBeGreaterThan(4);
  });

  it.each(ROOTS.flatMap(walk))("%s uses only spacing tokens that exist", (file) => {
    const source = readFileSync(file, "utf8");
    const unknown = [...source.matchAll(UTILITY)]
      .map((m) => m[1])
      // The derived numeric scale (p-4, gap-0.5) and Tailwind's own keywords.
      .filter((v) => !/^\d+(\.\d+)?$/.test(v))
      .filter((v) => !["px", "auto"].includes(v))
      .filter((v) => !SPACING.has(v));
    expect([...new Set(unknown)]).toEqual([]);
  });
});

/**
 * The same silent-failure shape as a missing spacing token: a component can
 * name a global class that globals.css never defines, and nothing errors.
 */
describe("global classes", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it.each(["section-enter"])("defines .%s", (name) => {
    expect(css).toContain(`.${name}`);
  });

  it("exempts .section-enter from motion for reduced-motion users", () => {
    const reduced = css.slice(css.indexOf(".section-enter"));
    expect(reduced).toMatch(/prefers-reduced-motion[\s\S]{0,300}\.section-enter/);
  });
});
