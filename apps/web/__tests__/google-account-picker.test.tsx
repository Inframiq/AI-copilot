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
