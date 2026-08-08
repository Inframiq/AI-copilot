import { describe, it, expect, vi, beforeEach } from "vitest";

const createBrowserClientMock = vi.fn();
const createServerClientMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: unknown[]) => createBrowserClientMock(...args),
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

// Import the real file by relative path — the vitest.config alias only
// intercepts "@/lib/supabase" imports elsewhere, not this direct import.
import { createBrowserClient, createServerClient } from "../lib/supabase";

describe("lib/supabase", () => {
  beforeEach(() => {
    createBrowserClientMock.mockClear();
    createServerClientMock.mockClear();
  });

  it("createBrowserClient forwards the configured URL and anon key", () => {
    createBrowserClient();
    expect(createBrowserClientMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String)
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
    expect(options.cookies.getAll()).toEqual([{ name: "sb-token", value: "abc" }]);

    options.cookies.setAll([{ name: "new-cookie", value: "xyz", options: {} }]);
    expect(cookieStore.set).toHaveBeenCalledWith("new-cookie", "xyz", {});
  });
});
