import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchange = vi.fn();
const getSession = vi.fn();
const profileLookup = vi.fn();
// What the browser sent, and every cookie the route set on the way out.
const jar = vi.hoisted(() => ({
  sent: new Map<string, string>(),
  set: [] as { name: string; value: string; options?: Record<string, unknown> }[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...jar.sent].map(([name, value]) => ({ name, value })),
    get: (name: string) => (jar.sent.has(name) ? { name, value: jar.sent.get(name)! } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      jar.set.push({ name, value, options }),
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: exchange, getSession },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: profileLookup }) }) }),
  }),
}));

import { GET, safeNextPath } from "@/app/(auth)/callback/route";
import { POLICY_CONSENT_COOKIE, POLICY_CONSENT_VALUE } from "@/lib/legal-versions";

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

// The Terms/Privacy checkbox lives only on the login and register pages, so a
// sign-in started anywhere else — straight at Supabase's authorize address,
// test ATK-037 — must not be recorded as agreement. Only a sign-in carrying
// the checkbox's marker cookie for the current versions is; everyone else is
// asked in the app by PolicyUpdatePrompt.
describe("agreement is recorded only when the checkbox was ticked (ATK-037)", () => {
  const CODE = "8d2e41b0-one-time-code-77aa";

  async function signIn(marker?: string) {
    if (marker !== undefined) jar.sent.set(POLICY_CONSENT_COOKIE, marker);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    exchange.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({
      data: { session: { access_token: "access-token", user: { id: "user-a" } } },
    });
    profileLookup.mockResolvedValue({ data: { user_id: "user-a" } });
    const res = await GET(new NextRequest(`https://kripax.inframiq.com/callback?code=${CODE}`));
    vi.unstubAllEnvs();
    const recorded = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/me/policy-acceptance")
    );
    return { res, recorded };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    jar.sent.clear();
    jar.set.length = 0;
  });

  it("records the current versions when the marker came with the sign-in", async () => {
    const { res, recorded } = await signIn(POLICY_CONSENT_VALUE);
    expect(res.headers.get("location")).toBe("https://kripax.inframiq.com/dashboard");
    expect(recorded).toHaveLength(1);
    const [, init] = recorded[0];
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer access-token");
  });

  it.each([
    ["no marker at all", undefined],
    ["a marker for older versions", "2025-01-01|2025-01-01"],
    ["a marker with any other value", "yes"],
  ])("records nothing with %s", async (_, marker) => {
    const { res, recorded } = await signIn(marker);
    // Sign-in itself still works; the app asks for agreement instead.
    expect(res.headers.get("location")).toBe("https://kripax.inframiq.com/dashboard");
    expect(recorded).toHaveLength(0);
  });

  it("uses the marker up, so it cannot vouch for a later sign-in", async () => {
    await signIn(POLICY_CONSENT_VALUE);
    expect(jar.set).toContainEqual({
      name: POLICY_CONSENT_COOKIE,
      value: "",
      options: { path: "/callback", maxAge: 0 },
    });
  });

  it("leaves no cookie behind when there was no marker", async () => {
    await signIn();
    expect(jar.set.map((c) => c.name)).not.toContain(POLICY_CONSENT_COOKIE);
  });
});
