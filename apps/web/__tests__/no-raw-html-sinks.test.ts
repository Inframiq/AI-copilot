import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

// Tests ATK-025 and ATK-026: React writes every value as text, so script can
// only get in where the code writes raw HTML or runs text as code. Each place
// that does is listed here with why it is safe; a new one anywhere else fails
// until it has been reviewed and added.

const ROOT = join(__dirname, "..");
const DIRS = ["app", "components", "lib"];

const REVIEWED: Record<string, { count: number; why: string }> = {
  "app/layout.tsx": {
    count: 2,
    why: "sidebar-state script, a constant string; the URL-token guard, built from the public Supabase URL and key quoted by JSON.stringify (url-token-guard.test.ts)",
  },
  "app/(marketing)/page.tsx": { count: 1, why: "JSON-LD, JSON.stringify of a constant" },
  "components/studio/ResumeCanvas.tsx": {
    count: 1,
    why: "the API's rendered résumé; every field escaped there (apps/api/tests/test_stored_xss_every_template.py)",
  },
  "lib/rich-text.ts": { count: 1, why: "parsed in an inert <template>, re-serialised through the b/i/u allowlist" },
};

const SINKS = [
  /dangerouslySetInnerHTML/,
  /\.innerHTML\s*=(?!=)/,
  /\.outerHTML\s*=(?!=)/,
  /insertAdjacentHTML\s*\(/,
  /document\.write(ln)?\s*\(/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /\bsrcDoc\s*=/,
  /createContextualFragment\s*\(/,
  /set(Timeout|Interval)\s*\(\s*["'`]/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

export function sinks(files: { path: string; text: string }[]): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const { path, text } of files) {
    text.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (/^\s*(\*|\/\*)/.test(line)) return; // comments describing a sink
      if (SINKS.some((re) => re.test(code))) (found[path] ||= []).push(`${path}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe("raw HTML and code from text", () => {
  it("appear only in the reviewed places", () => {
    const files = DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
      path: relative(ROOT, path).split(sep).join("/"),
      text: readFileSync(path, "utf8"),
    }));
    const found = sinks(files);
    const unexpected = Object.entries(found).flatMap(([path, lines]) =>
      REVIEWED[path] && REVIEWED[path].count === lines.length ? [] : lines,
    );
    expect(unexpected).toEqual([]);
    // A reviewed place that no longer has its sink should be taken off the list.
    expect(Object.keys(REVIEWED).filter((p) => !found[p])).toEqual([]);
  });

  it("catches the patterns it exists for", () => {
    const found = sinks([{
      path: "bad.tsx",
      text: [
        "<div dangerouslySetInnerHTML={{ __html: q }} />",
        "el.innerHTML = params.get('q');",
        "el.insertAdjacentHTML('beforeend', html);",
        "document.write(x);",
        "eval(code);",
        "new Function(body)();",
        "<iframe srcDoc={html} />",
        "setTimeout('run()', 10);",
        "if (el.innerHTML === '') {}",
        "// el.innerHTML = described in a comment",
        "setTimeout(() => run(), 10);",
      ].join("\n"),
    }]);
    expect(found["bad.tsx"].map((l) => Number(l.split(":")[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
