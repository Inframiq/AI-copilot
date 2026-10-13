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
