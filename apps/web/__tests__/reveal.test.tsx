// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSubscription: vi.fn().mockResolvedValue({ plan: "free", credits_remaining: 34, credits_allotment: 50, costs: {} }) },
}));
vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supabase", () => ({ createBrowserClient: () => ({}) }));

import { usePageReady, useShellRevealed } from "../lib/reveal";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Pages and the shell (credit balance, avatar) appear in one frame: a page
// still loading keeps the shell on its placeholders too.
describe("usePageReady", () => {
  it("holds the shell until the page's own data is in, then shows both", async () => {
    const { result, rerender } = renderHook(
      ({ pageReady }) => ({ page: usePageReady(pageReady), shell: useShellRevealed() }),
      { wrapper, initialProps: { pageReady: false } },
    );
    // The shell's own data loads; the page's hasn't.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current).toEqual({ page: false, shell: false });
    rerender({ pageReady: true });
    await waitFor(() => expect(result.current).toEqual({ page: true, shell: true }));
  });

  it("never goes back to placeholders once shown", async () => {
    const { result, rerender } = renderHook(({ pageReady }) => usePageReady(pageReady), {
      wrapper,
      initialProps: { pageReady: true },
    });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ pageReady: false });
    expect(result.current).toBe(true);
  });
});
