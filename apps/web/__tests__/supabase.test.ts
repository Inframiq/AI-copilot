import { describe, it, expect, vi, beforeEach } from "vitest";

const createBrowserClientMock = vi.fn();
const createServerClientMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => createBrowserClientMock(...args),
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

// Import the real file by relative path — the vitest.config alias only
// intercepts "@/lib/supabase" imports elsewhere, not this direct import.
import { createBrowserClient, createServerClient, leaveEndedSession, leaveSignedOut, signOutHere } from "../lib/supabase";

describe("lib/supabase", () => {
  beforeEach(() => {
    createBrowserClientMock.mockClear();
    createServerClientMock.mockClear();
  });

  it("createBrowserClient forwards the configured URL, anon key and secure cookies", () => {
    createBrowserClient();
    expect(createBrowserClientMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { cookieOptions: { secure: true } }
    );
  });

  it("createServerClient bridges getAll/set into the Supabase cookies adapter", () => {
    const store = new Map<string, string>();
    const cookieStore = {
      getAll: () => [{ name: "sb-token", value: "abc" }],
      set: vi.fn((name: string, value: string) => store.set(name, value)),
    };

    createServerClient(cookieStore);
    expect(createServerClientMock).toHaveBeenCalledOnce();

    const [, , options] = createServerClientMock.mock.calls[0];
    expect(options.cookieOptions).toEqual({ secure: true });
    expect(options.cookies.getAll()).toEqual([{ name: "sb-token", value: "abc" }]);

    options.cookies.setAll([{ name: "new-cookie", value: "xyz", options: {} }]);
    expect(cookieStore.set).toHaveBeenCalledWith("new-cookie", "xyz", {});
  });
});

describe("signOutHere", () => {
  it("always ends the session in this browser, even when the server sign-out fails", async () => {
    const signOut = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ error: null });
    createBrowserClientMock.mockReturnValue({ auth: { signOut } });
    await signOutHere();
    expect(signOut).toHaveBeenNthCalledWith(1);
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
  });
});

describe("leaveSignedOut", () => {
  it("leaves with a full page load that takes the page out of the history (ATK-008)", () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    try {
      leaveSignedOut();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(replace).toHaveBeenCalledWith("/login");
  });
});

describe("leaveEndedSession", () => {
  it("signs out on this device only, once, and says why on the sign-in page", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    createBrowserClientMock.mockReturnValue({ auth: { signOut } });
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    try {
      await Promise.all([leaveEndedSession(), leaveEndedSession()]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/login?ended=1");
  });
});
