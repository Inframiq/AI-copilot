// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const order = vi.hoisted(() => [] as string[]);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// See auth-back-link.test.tsx: auth pages mock "@/lib/supabase" explicitly.
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      signInWithOAuth: vi.fn(async () => {
        order.push("google");
        return { error: null };
      }),
    },
  }),
}));
vi.mock("@/lib/legal-versions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal-versions")>();
  return {
    ...actual,
    markPolicyConsent: vi.fn(() => {
      order.push("marker");
      actual.markPolicyConsent();
    }),
  };
});

import LoginPage from "../app/(auth)/login/page";
import RegisterPage from "../app/(auth)/register/page";
import {
  markPolicyConsent,
  POLICY_CONSENT_COOKIE,
  POLICY_CONSENT_VALUE,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@/lib/legal-versions";

/**
 * The Terms/Privacy checkbox is the only place agreement is given at sign-in,
 * and /callback records it only when this marker arrives (test ATK-037). So
 * the button must set it — for the current versions — before handing over to
 * Google, and only once the box is ticked.
 */
describe("the sign-in buttons carry the checkbox to /callback", () => {
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
  });

  it.each([
    ["sign in", LoginPage],
    ["sign up", RegisterPage],
  ])("%s sets the marker before leaving for Google", async (_label, Page) => {
    render(<Page />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(order).toEqual(["marker", "google"]));
  });

  it.each([
    ["sign in", LoginPage],
    ["sign up", RegisterPage],
  ])("%s sets nothing while the box is unticked", (_label, Page) => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(markPolicyConsent).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });
});

describe("the marker cookie", () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    vi.spyOn(Document.prototype, "cookie", "set").mockImplementation((v: string) => {
      written.push(v);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("names the current versions, goes only to /callback and expires soon", () => {
    expect(POLICY_CONSENT_VALUE).toBe(`${TERMS_VERSION}|${PRIVACY_VERSION}`);
    markPolicyConsent();
    expect(written).toHaveLength(1);
    const parts = written[0].split("; ");
    expect(parts[0]).toBe(`${POLICY_CONSENT_COOKIE}=${encodeURIComponent(POLICY_CONSENT_VALUE)}`);
    expect(parts).toContain("Path=/callback");
    expect(parts).toContain("Max-Age=900");
    expect(parts).toContain("SameSite=Lax");
  });
});
