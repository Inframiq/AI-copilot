// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { urlTokenGuardScript } from "@/lib/url-token-guard";

const SUPABASE = "https://example.supabase.co";
const run = () => new Function(urlTokenGuardScript(SUPABASE, "anon-key"))();

describe("a sign-in token in the address (batch mate's OAUTH-005)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState(null, "", "/");
  });

  it("is taken out of the address, keeping the page and its query", () => {
    history.replaceState(null, "", "/dashboard?tour=1#access_token=AAA.BBB.CCC&expires_in=3600&refresh_token=rrr&token_type=bearer");
    run();
    expect(location.pathname + location.search + location.hash).toBe("/dashboard?tour=1");
    expect(location.href).not.toContain("AAA.BBB.CCC");
    expect(location.href).not.toContain("rrr");
  });

  it("and its session is ended, so a copy made earlier is no use", () => {
    history.replaceState(null, "", "/#access_token=AAA.BBB.CCC&refresh_token=rrr");
    run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SUPABASE}/auth/v1/logout?scope=local`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer AAA.BBB.CCC");
    expect(init.headers.apikey).toBe("anon-key");
  });

  it("a refresh token alone is removed too", () => {
    history.replaceState(null, "", "/#refresh_token=rrr");
    run();
    expect(location.hash).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/", "/jd#notes", "/studio/x#section-experience", "/#tokens=3", "/?code=abc"])(
    "an address without a token is left alone: %s",
    (address) => {
      history.replaceState(null, "", address);
      run();
      expect(location.pathname + location.search + location.hash).toBe(address);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("quotes the values it is built from", () => {
    const script = urlTokenGuardScript('https://x.co"+alert(1)+"', "k");
    expect(script).toContain('"https://x.co\\"+alert(1)+\\"/auth/v1/logout?scope=local"');
  });
});
