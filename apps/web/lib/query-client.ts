import { QueryClient } from "@tanstack/react-query";

/**
 * The app's single QueryClient. Exported so non-component code (Zustand
 * stores, plain modules) can invalidate cached queries — e.g. the tailoring
 * store bumps ["subscription"] after a tailor spends credits so the credit
 * meter updates immediately instead of waiting for a refetch.
 *
 * This is a client-only app (every entry point is "use client"), so a
 * module-level instance is one-per-browser-tab, which is what we want.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } },
});
