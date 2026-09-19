// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The vitest.config alias for "@/lib/supabase" never fires — the broader "@"
// alias is declared first and matches the path before it. Every test that
// renders an auth page mocks the module explicitly instead.
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({ auth: { signInWithOAuth: vi.fn(async () => ({ error: null })) } }),
}));

import LoginPage from "../app/(auth)/login/page";
import RegisterPage from "../app/(auth)/register/page";

/**
 * Sign-in and sign-up are reachable directly — the landing page's CTAs, a
 * bookmark, an expired session's redirect — so a user who lands on either and
 * changes their mind needs a way out that does not depend on browser history.
 */
describe("the way back out of the auth screens", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["sign in", LoginPage],
    ["sign up", RegisterPage],
  ])("gives %s a link home", (_label, Page) => {
    render(<Page />);
    const back = screen.getByRole("link", { name: /back to home/i });
    expect(back).toHaveAttribute("href", "/");
  });

  it("keeps sign-in and sign-up pointing at each other", () => {
    const { unmount } = render(<LoginPage />);
    expect(screen.getByRole("link", { name: /^register$/i })).toHaveAttribute(
      "href",
      "/register",
    );
    unmount();

    render(<RegisterPage />);
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", "/login");
  });
});
