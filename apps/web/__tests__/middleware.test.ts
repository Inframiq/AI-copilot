// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let currentUser: { id: string; email?: string } | null = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const { middleware } = await import("../middleware");

const visit = (path: string) => middleware(new NextRequest(`https://kripax.inframiq.com${path}`));

describe("middleware: where a signed-in person lands", () => {
  beforeEach(() => {
    currentUser = null;
  });

  // The KripaX logo on the legal pages (linked from Account) points at "/".
  // Signed in, that showed the marketing page with "Sign In" — it read as
  // being logged out.
  it.each(["/", "/login", "/register"])("sends someone signed in from %s to the dashboard", async (path) => {
    currentUser = { id: "u1", email: "jane@example.com" };
    const res = await visit(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("sends an admin-only account to the admin dashboard instead", async () => {
    currentUser = { id: "a1", email: "tanishqkundrapu@gmail.com" };
    const res = await visit("/");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });

  it("still shows the home page and sign-in to someone signed out", async () => {
    for (const path of ["/", "/login", "/register"]) {
      const res = await visit(path);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("leaves the legal pages readable when signed in", async () => {
    currentUser = { id: "u1", email: "jane@example.com" };
    const res = await visit("/terms");
    expect(res.headers.get("location")).toBeNull();
  });
});

// Every page is for signed-in people unless it is one of these (test
// ATK-001). Pages are found on disk, so a page added later is checked too.
const PUBLIC_PAGES = ["/", "/login", "/register", "/privacy", "/terms", "/refunds", "/cookies", "/data-deletion"];

function allPages(): string[] {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const root = path.join(__dirname, "..", "app");
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const route = path.relative(root, dir).split(path.sep)
          .filter((seg) => seg && !/^\(.*\)$/.test(seg))
          .map((seg) => (/^\[.*\]$/.test(seg) ? "00000000-0000-4000-8000-000000000001" : seg));
        pages.push("/" + route.join("/"));
      }
    }
  };
  walk(root);
  return pages.map((p) => (p === "/" ? p : p.replace(/\/$/, ""))).sort();
}

describe("middleware: a visitor who isn't signed in", () => {
  beforeEach(() => {
    currentUser = null;
  });

  it("finds the app's pages", () => {
    expect(allPages()).toEqual(expect.arrayContaining(["/dashboard", "/cover-letters", "/studio/00000000-0000-4000-8000-000000000001/preview", "/admin"]));
    expect(allPages().length).toBeGreaterThanOrEqual(25);
  });

  it.each(allPages().filter((p) => !PUBLIC_PAGES.includes(p)))("is sent to sign-in from %s", async (path) => {
    const res = await visit(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("is sent to sign-in from an address that isn't a page yet", async () => {
    const res = await visit("/settings/billing");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it.each([...PUBLIC_PAGES, "/callback"])("can open %s", async (path) => {
    const res = await visit(path);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/brand/logo-full.png", "/resume-templates/ats_clean.png", "/.well-known/security.txt", "/robots.txt", "/sitemap.xml", "/icon.png"])(
    "can load the public file %s",
    async (path) => {
      const res = await visit(path);
      expect(res.headers.get("location")).toBeNull();
    }
  );
});
