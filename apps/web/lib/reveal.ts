"use client";
import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
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
 * useShellDataReady. A page that draws its data in one go also holds the
 * shell back (useHoldShell) until that page is ready, so the two arrive
 * together. Until then each shows a placeholder the size of what replaces it.
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
