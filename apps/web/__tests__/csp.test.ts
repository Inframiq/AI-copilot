import { describe, it, expect } from "vitest";
import { buildCsp, createNonce } from "../lib/csp";

const ENV = { apiUrl: "https://api.example.com/v1", supabaseUrl: "https://proj.supabase.co", isDev: false };

describe("buildCsp", () => {
  it("runs only scripts carrying this request's nonce, and never eval in production", () => {
    const csp = buildCsp("abc123", ENV);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic';");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("lets the page reach the API and Supabase, by origin", () => {
    const csp = buildCsp("n", ENV);
    expect(csp).toContain("connect-src 'self' https://api.example.com https://proj.supabase.co wss://proj.supabase.co");
    expect(csp).toContain("img-src 'self' data: blob: https://proj.supabase.co");
  });

  it("allows eval only in development", () => {
    expect(buildCsp("n", { ...ENV, isDev: true })).toContain("'unsafe-eval'");
  });

  it("drops a missing or malformed URL instead of writing a broken source", () => {
    const csp = buildCsp("n", { apiUrl: "not a url", supabaseUrl: undefined, isDev: false });
    expect(csp).toContain("connect-src 'self';");
  });
});

describe("createNonce", () => {
  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, createNonce));
    expect(seen.size).toBe(50);
  });
});
