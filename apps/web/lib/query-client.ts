import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";

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
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // A 4xx is an answer, not a blip: out of credits (402), not found,
      // not allowed. Retrying only delays it showing and repeats the call.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 3,
    },
  },
});
