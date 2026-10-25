// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A signed-out tab must not keep showing signed-in pages (test ATK-008).
type Listener = (event: string, session?: { user: { id: string } } | null) => void;
let authListener: Listener | null = null;
const unsubscribe = vi.fn();
const getSession = vi.fn();
const leave = vi.fn();
const replace = vi.fn();
Object.defineProperty(window, "location", { value: { ...window.location, replace }, writable: true });

vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      onAuthStateChange: (cb: Listener) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe } } };
      },
      getSession: () => getSession(),
    },
  }),
  leaveSignedOut: () => leave(),
}));

import { SessionGuard } from "../../components/auth/SessionGuard";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function pageshow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("SessionGuard", () => {
  beforeEach(() => {
    authListener = null;
    unsubscribe.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({ data: { session: null } });
    leave.mockReset();
    replace.mockReset();
  });

  it("leaves when the session ends, here or in another tab", () => {
    render(<SessionGuard />);
    authListener!("TOKEN_REFRESHED");
    expect(leave).not.toHaveBeenCalled();
    authListener!("SIGNED_OUT");
    expect(leave).toHaveBeenCalledOnce();
  });

  it("leaves when Back restores a page from memory with no session behind it", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    render(<SessionGuard />);
    pageshow(true);
    await waitFor(() => expect(leave).toHaveBeenCalledOnce());
  });

  it("stays when the restored page is still signed in", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t", user: { id: "A" } } } });
    render(<SessionGuard />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    pageshow(true);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    expect(leave).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores an ordinary page load", async () => {
    render(<SessionGuard />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1)); // whose page, once
    pageshow(false);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("stops listening when it unmounts", async () => {
    const { unmount } = render(<SessionGuard />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    pageshow(true);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  // Test ATK-049: A's page must never stay on screen for B.
  it("leaves when Back restores A's page while B is signed in", async () => {
    getSession.mockResolvedValueOnce({ data: { session: { access_token: "a", user: { id: "A" } } } });
    render(<SessionGuard />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    getSession.mockResolvedValue({ data: { session: { access_token: "b", user: { id: "B" } } } });
    pageshow(true);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(leave).not.toHaveBeenCalled();
  });

  it("leaves when B signs in from another tab while A's page is open", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "a", user: { id: "A" } } } });
    render(<SessionGuard />);
    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    authListener!("TOKEN_REFRESHED", { user: { id: "A" } });
    expect(replace).not.toHaveBeenCalled();
    authListener!("SIGNED_IN", { user: { id: "B" } });
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("is on every layout the middleware protects", () => {
    for (const layout of ["app/(app)/layout.tsx", "app/(builder)/layout.tsx", "app/admin/layout.tsx"]) {
      expect(readFileSync(join(process.cwd(), layout), "utf8"), layout).toContain("<SessionGuard />");
    }
  });

  it("every sign-out leaves with a full page load, never through the router", () => {
    const callers = ["app", "components", "lib", "stores"]
      .flatMap((dir) => walk(join(process.cwd(), dir)))
      .filter((file) => !file.endsWith(join("lib", "supabase.ts")))
      .filter((file) => readFileSync(file, "utf8").includes("signOutHere()"));
    expect(callers.length).toBeGreaterThanOrEqual(3);
    for (const file of callers) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toContain("leaveSignedOut()");
      expect(src, file).not.toMatch(/router\.(push|replace)\(["']\/login/);
    }
  });
});
