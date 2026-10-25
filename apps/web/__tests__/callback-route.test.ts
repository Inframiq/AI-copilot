import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchange = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

import { GET, safeNextPath } from "@/app/(auth)/callback/route";

describe("safeNextPath", () => {
  it("allows a same-origin relative path", () => {
    expect(safeNextPath("/studio")).toBe("/studio");
  });

  it("falls back to /dashboard when next is missing", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
  });

  it("rejects an absolute off-site URL", () => {
    expect(safeNextPath("https://evil.com/login")).toBe("/dashboard");
  });

  it("rejects a protocol-relative off-site URL", () => {
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
  });

  it("rejects a backslash-based off-site URL", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
  });

  it("rejects a javascript: URL", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });
});

describe("failed sign-in callbacks are logged (INF-004)", () => {
  const CODE = "3f9c2a7e-one-time-code-5b1d";

  function call(query: string) {
    return GET(
      new NextRequest(`https://kripax.inframiq.com/callback${query}`, {
        headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      })
    );
  }

  function logged(spy: ReturnType<typeof vi.spyOn>): string {
    return spy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
  }

  afterEach(() => {
    vi.restoreAllMocks();
    exchange.mockReset();
  });

  it("logs a refused code exchange without the code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    exchange.mockResolvedValue({
      error: { code: "flow_state_not_found", status: 404, message: "invalid flow state" },
    });
    const res = await call(`?code=${CODE}`);
    expect(res.headers.get("location")).toContain("/login?error=auth");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logged(warn)).toBe(
      "security_event=sign_in_failed reason=exchange_failed detail=flow_state_not_found ip=203.0.113.9"
    );
    expect(logged(warn)).not.toContain(CODE);
  });

  it("logs a sign-in cancelled at Google", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await call("?error=access_denied&error_description=The+user+denied");
    expect(logged(warn)).toBe(
      "security_event=sign_in_failed reason=provider_error detail=access_denied ip=203.0.113.9"
    );
    expect(exchange).not.toHaveBeenCalled();
  });

  it("logs a callback with no code at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await call("");
    expect(logged(warn)).toContain("reason=missing_code detail=-");
  });

  // A failed or forged callback must leave no trace of a sign-in (test
  // ATK-032): no session cookie, no consent recorded against anyone, no
  // profile lookup — just the way back to the login page.
  it.each([
    ["a refused code", `?code=${CODE}`],
    ["a sign-in cancelled at Google", "?error=access_denied"],
    ["no code at all", ""],
    ["a refused code with a next page", `?code=${CODE}&next=/dashboard`],
  ])("%s signs nobody in", async (_, query) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Set, so recording consent would really call out rather than skip.
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    exchange.mockResolvedValue({ error: { code: "bad_code_verifier", status: 400 } });
    const res = await call(query);
    vi.unstubAllEnvs();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://kripax.inframiq.com/login?error=auth");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cannot be made to write a second log line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await call("?error=x%0Asecurity_event%3Dforged");
    expect(logged(warn)).not.toContain("\n");
    expect(logged(warn)).toContain("detail=x?security_event?forged");
  });
});
