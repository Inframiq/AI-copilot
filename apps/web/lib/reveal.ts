"use client";
import { useLayoutEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import { createBrowserClient } from "@/lib/supabase";
import { getCareerProfile } from "@/lib/career-profile-client";
import { avatarPath, avatarSrcQuery } from "@/lib/avatar-url";
import type { Subscription } from "@career-copilot/types";

/*
 * What the app shows about the signed-in user appears in one frame, never
 * piece by piece. Each part used to draw itself when its own request came
 * back, so a cold dashboard went "My Profile · 0 · No resumes yet" → name →
 * numbers → résumés → credit balance in five steps over about two seconds.
 *
 * The shell's own parts (credit balance, avatar) wait for each other:
 * useShellDataReady. Every page with data calls usePageReady with whether
 * its own data has settled: until that and the shell's data are both in, the
 * page shows placeholders and holds the shell back too, so page and shell
 * arrive in the same frame.
 *
 * "Ready" means settled: loaded, or failed after its retries — a failure
 * shows its own error rather than holding the page forever.
 */

export const subscriptionQuery = {
  queryKey: ["subscription"],
  queryFn: () => apiClient.getSubscription(),
  staleTime: 30_000,
} as const;

export const careerProfileQuery = {
  queryKey: ["careerProfile"],
  queryFn: getCareerProfile,
  staleTime: 2 * 60 * 1000,
} as const;

/** Who is signed in (Supabase's own record): the sign-in email, the name
 * Google gave, when the account was made. */
export const authUserQuery = {
  queryKey: ["authUser"],
  queryFn: async () => (await createBrowserClient().auth.getUser()).data.user,
  staleTime: 5 * 60 * 1000,
} as const;

/** True when none of these queries is still waiting for its first answer. */
export function settled(...queries: { isPending: boolean }[]): boolean {
  return queries.every((q) => !q.isPending);
}

const useHolds = create<{ holds: number }>(() => ({ holds: 0 }));

/** True once the credit balance, the profile and the avatar's photo link
 * have all settled. */
export function useShellDataReady(): boolean {
  const subscription = useQuery<Subscription>(subscriptionQuery);
  const profile = useQuery(careerProfileQuery);
  const photoUrl = profile.data?.photo_url ?? null;
  // A disabled query reads as pending, so only a photo that needs a link counts.
  const photo = useQuery(avatarSrcQuery(photoUrl));
  return !subscription.isPending && !profile.isPending && !(avatarPath(photoUrl) !== null && photo.isPending);
}

/** True when the shell's parts may show their data: theirs has settled and
 * no page is still holding them back. */
export function useShellRevealed(): boolean {
  const ready = useShellDataReady();
  const held = useHolds((s) => s.holds > 0);
  return ready && !held;
}

/** Keeps the shell on its placeholders while `holding`. A layout effect, so
 * the release lands in the same frame as the page's own reveal. */
export function useHoldShell(holding: boolean): void {
  useLayoutEffect(() => {
    if (!holding) return;
    useHolds.setState((s) => ({ holds: s.holds + 1 }));
    return () => useHolds.setState((s) => ({ holds: s.holds - 1 }));
  }, [holding]);
}

/**
 * For a page: true once its own data (`pageReady`) and the shell's have
 * settled — the moment to replace its placeholders with everything at once.
 * Holds the shell's placeholders until then. Once true it stays true for
 * this visit, so a later refetch or a change made on the page never brings
 * the placeholders back.
 */
export function usePageReady(pageReady: boolean): boolean {
  const shellReady = useShellDataReady();
  const shown = useRef(false);
  if (shellReady && pageReady) shown.current = true;
  useHoldShell(!shown.current);
  return shown.current;
}
