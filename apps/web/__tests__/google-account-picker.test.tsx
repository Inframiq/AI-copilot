// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const signInWithOAuth = vi.hoisted(() => vi.fn(async (_args: unknown) => ({ error: null })));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// See auth-back-link.test.tsx: auth pages mock "@/lib/supabase" explicitly.
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({ auth: { signInWithOAuth } }),
}));

import LoginPage from "../app/(auth)/login/page";
import RegisterPage from "../app/(auth)/register/page";

/**
 * Without prompt=select_account, Google signs straight back into the one
 * account the browser already holds, so after signing out nobody can switch
 * to another Google account (found during test ATK-049).
 */
describe("the sign-in page after this device's sign-in ended", () => {
  it("says why: a newer sign-in on another device, past the limit", () => {
    window.history.replaceState(null, "", "/login?ended=1");
    try {
      render(<LoginPage />);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Signed out on this device. An account can be signed in on 2 devices at a time, and a newer sign-in ended this one.",
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("says nothing on an ordinary visit", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the Google buttons always let the person pick an account", () => {
  it.each([
    ["sign in", LoginPage],
    ["sign up", RegisterPage],
  ])("%s asks Google for its account picker", async (_label, Page) => {
    signInWithOAuth.mockClear();
    render(<Page />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(signInWithOAuth.mock.calls[0][0]).toMatchObject({
      provider: "google",
      options: { queryParams: { prompt: "select_account" } },
    });
  });
});
