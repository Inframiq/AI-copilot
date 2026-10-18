import { describe, it, expect } from "vitest";
import nextConfig from "../next.config";

// Test WEB-001: the headers every page is served with. The per-request CSP
// is built in lib/csp.ts and covered by csp.test.ts.
describe("security headers", () => {
  it("sends the browser protections on every path and no framework banner", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    const headers = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    expect(headers).toMatchObject({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });
});
