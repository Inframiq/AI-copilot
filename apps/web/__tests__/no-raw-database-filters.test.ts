import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// Test DB-002: the browser's Supabase queries never build their filter or
// column text from pieces. supabase-js passes .or(), .filter(), .not(),
// .textSearch() and .select() strings to the Data API as query syntax, so a
// value joined into one could add conditions or columns. Values go through
// .eq() and friends, which send them as values.

const ROOT = join(__dirname, "..");
const DIRS = ["app", "components", "lib"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Text built from pieces: a template with ${...}, or a string joined with +.
const PIECES = /`[^`]*\$\{|["'`]\s*\+|\+\s*["'`]|[A-Za-z_$][\w$.]*\s*\+\s*[A-Za-z_$"'`]/;
// .or() and .select() take raw syntax as their first argument.
const FIRST_ARG = /\.(or|select)\(([^)]*)\)/g;
// .filter(), .not() and .textSearch() name a column first (a string), then
// take raw syntax. Array.prototype.filter takes a function, so it never matches.
const COLUMN_FIRST = /\.(filter|not|textSearch)\(\s*(["'`][^"'`]*["'`])\s*,([^)]*)\)/g;

function raw(line: string): boolean {
  for (const m of line.matchAll(FIRST_ARG)) if (PIECES.test(m[2])) return true;
  for (const m of line.matchAll(COLUMN_FIRST)) if (PIECES.test(m[2]) || PIECES.test(m[3])) return true;
  return false;
}

export function offences(files: { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) =>
    text.split("\n").flatMap((line, i) => (raw(line) ? [`${path}:${i + 1}: ${line.trim()}`] : []))
  );
}

describe("database queries from the browser", () => {
  it("never build filter or column text from pieces", () => {
    const files = DIRS.flatMap((d) => sourceFiles(join(ROOT, d))).map((path) => ({
      path: relative(ROOT, path),
      text: readFileSync(path, "utf8"),
    }));
    expect(offences(files)).toEqual([]);
  });

  it("catches the patterns it exists for", () => {
    const found = offences([{
      path: "bad.ts",
      text: [
        "q.or(`title.eq.${title},user_id.eq.${me}`)",
        "q.filter('headline', 'eq', 'x' + headline)",
        "q.select(cols + ',email')",
        "q.textSearch(`fts`, `${term}`)",
        "q.eq('user_id', me).select('user_id, headline')",
        "items.filter((x) => x.ok)",
      ].join("\n"),
    }]);
    expect(found.map((f) => f.split(":")[1])).toEqual(["1", "2", "3", "4"]);
  });
});
