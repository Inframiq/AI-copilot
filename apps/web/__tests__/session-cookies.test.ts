import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
// The real file, by relative path — the vitest alias only stubs the
// "@/lib/supabase" spelling used elsewhere in the app.
import { SESSION_COOKIE_OPTIONS } from "../lib/supabase";

// Test WEB-002: the session cookies hold a live access and refresh token, so
// every Supabase client that writes them must mark them Secure. @supabase/ssr
// leaves that flag off by default, which is easy to reintroduce by creating a
// client without cookieOptions — so this guards the flag and the call sites.

const ROOT = join(__dirname, "..");
const DIRS = ["app", "lib"];
const FILES = ["middleware.ts"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

export function offences(files: { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) => {
    const createsClient = /create(Browser|Server)Client\s*\(\s*[^)]/.test(text);
    const isDefinition = /export const SESSION_COOKIE_OPTIONS/.test(text);
    if (!createsClient || isDefinition) return [];
    return text.includes("cookieOptions: SESSION_COOKIE_OPTIONS")
      ? []
      : [`${path}: creates a Supabase client without the secure session cookie options`];
  });
}

describe("session cookies", () => {
  it("are marked Secure outside development", () => {
    expect(SESSION_COOKIE_OPTIONS.secure).toBe(true);
  });

  it("are set by every Supabase client the app creates", () => {
    const files = [
      ...DIRS.flatMap((d) => sourceFiles(join(ROOT, d))),
      ...FILES.map((f) => join(ROOT, f)),
    ].map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));
    expect(offences(files)).toEqual([]);
  });
});
